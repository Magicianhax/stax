// Client-safe view models and rules for BSC tokenized stocks. The RWA Data API reports each
// token's on-chain price next to the underlying share's reference price, plus whether the
// issuer will trade it right now. Everything that shows or buys a BSC stock reads these.
import type { RwaPlatform } from "./chains";
import { usMarketState } from "./marketHours";

/** Stax's own display state. The API calls the regular session "regular"; Stax calls it "open". */
export type MarketState = "open" | "premarket" | "postmarket" | "overnight" | "closed" | "paused" | "unsupported";

/**
 * The session as the RWA Data API reports it. Docs spell the pause "pause" and the live API
 * sends "paused", so both are accepted. bStock rows always send null.
 */
export type RwaMarketStatus = "premarket" | "regular" | "postmarket" | "overnight" | "closed" | "paused" | "pause";

/**
 * Why a token is or is not tradeable. Known values are listed for completion; any string is
 * accepted, because a new code from the API must not break the catalog. Only "TRADING" buys.
 */
export type RwaReasonCode =
  | "TRADING"
  | "MARKET_CLOSED"
  | "MARKET_PAUSED"
  | "MARKET_MAINTENANCE"
  | "ASSET_PAUSED"
  | "ASSET_LIMITED"
  | "UNSUPPORTED"
  | (string & {});

/** Binance rejects quotes of $5 or less (40375), and the floor is exclusive, so a leg needs $6. */
export const BSC_MIN_LEG_USD = 6;

/**
 * A sale only has to clear Binance's real floor (over $5). The $6 buffer exists so a BUY lands
 * above the floor after fees and price moves; applying it to a sale trapped a position bought at
 * the $6 minimum (worth about $5.97 after Binance's fee) with no way to sell it.
 */
export const BSC_MIN_SELL_USD = 5.01;

/** The smallest leg Stax will send for `side` on BSC. */
export function minLegUsd(side: "buy" | "sell"): number {
  return side === "sell" ? BSC_MIN_SELL_USD : BSC_MIN_LEG_USD;
}

/**
 * Sell-tab chips (25/50/75/All) that would come out under Binance's floor for a position worth
 * `positionUsd`. An unknown value leaves every chip enabled; the server still decides.
 */
export function sellShareClearsFloor(positionUsd: number | undefined, pct: number): boolean {
  if (positionUsd === undefined || !Number.isFinite(positionUsd)) return true;
  return (positionUsd * pct) / 100 >= BSC_MIN_SELL_USD;
}

export interface VenueView {
  platform: RwaPlatform;
  symbol: string;
  address: `0x${string}`;
  tokenPrice: number;
  referencePrice: number;
  /** Token premium over the reference, in percent; null when there is no usable reference. */
  gapPct: number | null;
  state: MarketState;
  buyable: boolean;
  nextOpenMs: number | null;
  updatedAt: number;
}

export interface RwaTickerView {
  ticker: string;
  name: string;
  type: "stock" | "etf" | "other";
  venues: VenueView[];
  /** The venue a buy should use right now: buyable, then the lower cost against the real share (lib/spread.ts compareForBuyer). Null when none is. */
  bestVenue: RwaPlatform | null;
}

/** `GET /api/rwa?chain=bsc` (Task 9). `asOf` is epoch ms of the catalog snapshot. */
export interface RwaListResponse {
  tickers: RwaTickerView[];
  asOf: number;
}

/** An issuer trades a token only when it is open AND its reason code says TRADING. */
export function isBuyable(s: { openState: boolean; reasonCode: RwaReasonCode }): boolean {
  return s.openState && s.reasonCode === "TRADING";
}

export function gapPct(tokenPrice: number, referencePrice: number): number | null {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(tokenPrice)) return null;
  return ((tokenPrice - referencePrice) / referencePrice) * 100;
}

/**
 * The display state for a row, from what the API says. Null means the API gave no session
 * (every bStock row), and the caller must fall back to Stax's own US-market calendar rather
 * than guess from `openState`, which says whether the issuer trades, not what time it is.
 */
export function marketStateFrom(s: { marketStatus: RwaMarketStatus | null; reasonCode: RwaReasonCode }): MarketState | null {
  if (s.reasonCode === "UNSUPPORTED") return "unsupported";
  switch (s.marketStatus) {
    case null:
      return null;
    case "regular":
      return "open";
    case "paused":
    case "pause":
      return "paused";
    default:
      return s.marketStatus;
  }
}

/**
 * Whether the BSC Sell button is off. A stock sells through its own issuer, so that issuer has to
 * be trading; crypto (BTCB, ETH, BNB) has no catalog row and no market hours, so it is never
 * blocked by the venue gate (the same exemption useBscBuyGate gives a crypto buy).
 */
export function bscSellBlocked(tier: string | undefined, venue: { buyable: boolean } | undefined): boolean {
  if (tier === "crypto") return false;
  return !venue?.buyable;
}

/** The slice of a Binance row's `statusInfo` that decides its state and whether it can be bought. */
export interface RwaStatusLike {
  openState: boolean;
  marketStatus: RwaMarketStatus | null;
  reasonCode: RwaReasonCode;
}

/**
 * `state` for one row at `nowMs`. `marketStateFrom` reads the API's own session — bStock's
 * statusInfo carries no session at all (`marketStatus` always null) so it always falls through,
 * but so does an Ondo row that gives no session either, and both need the same two fallbacks in
 * order: first, a non-TRADING reason the issuer already flagged as not open (`openState` false) is
 * Stax's own "paused" state, not a guess. Only when the row gives no signal at all does the
 * US-hours calendar stand in. One rule for the catalog AND the trade gate, so a row can't read
 * "open" on Market and then be bought after the close (or the reverse).
 */
export function venueState(s: RwaStatusLike, nowMs: number): MarketState {
  const fromApi = marketStateFrom(s);
  if (fromApi !== null) return fromApi;
  if (!s.openState && s.reasonCode !== "TRADING") return "paused";
  return usMarketState(nowMs);
}

/**
 * Whether a buy of this row is allowed at `nowMs`. `state` and `isBuyable` come from independent
 * signals (the calendar vs. the issuer's own flags) and can disagree: an issuer that still claims
 * TRADING after Stax's own clock says the market is closed must never read as buyable, because
 * that is exactly the weekend-premium buy Vera is supposed to refuse. The calendar wins.
 */
export function venueBuyable(s: RwaStatusLike, nowMs: number): boolean {
  return venueState(s, nowMs) === "closed" ? false : isBuyable(s);
}

/**
 * The price a screen prints for an asset: the live number when there is one; else the hard-coded
 * display table's "reference" price, except on BNB Chain outside the demo. There a Binance outage
 * or rate limit used to leave the table's number (Nvidia at $134.19) on screen as if it were live,
 * next to a Buy button that works, so no live price reads as "no price" (undefined).
 */
export function priceOrStatic(p: { bsc: boolean; demo: boolean; live: number | null | undefined; staticPrice: number | undefined }): number | undefined {
  if (p.live !== null && p.live !== undefined) return p.live;
  return p.bsc && !p.demo ? undefined : p.staticPrice;
}
