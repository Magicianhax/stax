// Client-safe view models and rules for BSC tokenized stocks. The RWA Data API reports each
// token's on-chain price next to the underlying share's reference price, plus whether the
// issuer will trade it right now. Everything that shows or buys a BSC stock reads these.
import type { RwaPlatform } from "./chains";

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
  /** The venue a buy should use right now: buyable, then the smallest gap. Null when none is. */
  bestVenue: RwaPlatform | null;
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
