// Client-safe types and pure rules for "price vs the real share" and "the two issuers": whether
// a token's price counts as a premium while the underlying market is shut, a discount worth
// acting on while it's still buyable, the price difference between bStock and Ondo for one
// dual-listed ticker, a ranked board of those differences, and which issuer is cheaper right
// now. Nothing here calls the network — every input is exactly what lib/rwa.ts's VenueView
// already carries (buildCatalog in lib/server/rwaCatalog.ts builds it from the live catalog),
// so app/api/rwa/spread and the cron are thin callers of this, not a second source of truth.
//
// User-facing words only: "the real share" and "the two issuers", never "spread", "gap",
// "venue", "bps" or any other on-chain jargon — Review Focus for this stream.
import type { RwaPlatform } from "./chains";
import type { MarketState, VenueView } from "./rwa";

/** How far above the real share, while the underlying market is shut, counts as a premium worth flagging. */
export const PREMIUM_THRESHOLD_PCT = 1;
/** How far below the real share, while still buyable, counts as a discount worth flagging. */
export const DISCOUNT_THRESHOLD_PCT = 1;
/** How many days of price-vs-real-share history a ticker's page keeps. */
export const SPREAD_HISTORY_DAYS = 7;
/** Minutes enforced between two kept snapshots for the same ticker + issuer, once trimmed. */
export const SPREAD_SNAPSHOT_SPACING_MINUTES = 15;

export type SpreadLabel = "premium" | "discount" | "in_line" | "unknown";

export interface SpreadCall {
  label: SpreadLabel;
  /** Plain sentence for the viewer, e.g. "5.2% more than the real share while the market is closed". */
  sentence: string;
}

/** States where the underlying share isn't trading right now — the reference price is stale. */
const CLOSED_MARKET_STATES: ReadonlySet<MarketState> = new Set(["closed", "overnight", "paused", "unsupported"]);

export function isMarketClosedState(state: MarketState): boolean {
  return CLOSED_MARKET_STATES.has(state);
}

/**
 * States outside the NYSE regular session — the closed states plus pre/post market. DESIGN.md's
 * "Market hours & reference price" section is explicit that the reference price (Chainlink) only
 * moves while the regular session is open, so a token trading above it during premarket or
 * postmarket is exactly the same "you'd be overpaying against a stale reference" story as a full
 * weekend premium. `isMarketClosedState` stays narrower (actually shut, not just outside the
 * regular session) because other callers may care about that distinction; this is the set the
 * premium rule needs.
 */
const OUTSIDE_REGULAR_HOURS_STATES: ReadonlySet<MarketState> = new Set([
  ...CLOSED_MARKET_STATES,
  "premarket",
  "postmarket",
]);

export function isOutsideRegularHours(state: MarketState): boolean {
  return OUTSIDE_REGULAR_HOURS_STATES.has(state);
}

export interface SpreadInput {
  gapPct: number | null;
  buyable: boolean;
  state: MarketState;
}

/**
 * The premium/discount call for one venue right now. A premium only fires while the market is
 * shut (open-market moves aren't the weekend-premium story this stream tracks); a discount only
 * fires while the token is actually buyable (a cheap price nobody can act on isn't useful to
 * surface as one). Both thresholds are inclusive at the boundary and overridable per call so a
 * screen can tune sensitivity without a second copy of this function.
 */
export function classifySpread(
  v: SpreadInput,
  thresholds: { premiumPct?: number; discountPct?: number } = {},
): SpreadCall {
  const premiumPct = thresholds.premiumPct ?? PREMIUM_THRESHOLD_PCT;
  const discountPct = thresholds.discountPct ?? DISCOUNT_THRESHOLD_PCT;
  if (v.gapPct === null) return { label: "unknown", sentence: "No price to compare right now." };
  if (isOutsideRegularHours(v.state) && v.gapPct >= premiumPct) {
    // "Closed for the day" only when it actually is; premarket/postmarket still has a session
    // today, it's just not open yet or already done, so "outside normal hours" reads true there.
    const when = isMarketClosedState(v.state) ? "closed for the day" : "outside normal hours";
    return { label: "premium", sentence: `${v.gapPct.toFixed(1)}% more than the real share while the stock market is ${when}` };
  }
  if (v.buyable && v.gapPct <= -discountPct) {
    return { label: "discount", sentence: `${Math.abs(v.gapPct).toFixed(1)}% less than the real share right now` };
  }
  return { label: "in_line", sentence: "About the same as the real share" };
}

const PLATFORM_LABEL: Record<RwaPlatform, string> = { bstock: "bStock", ondo: "Ondo" };

/** Display name for an issuer — same mapping VenuePicker already uses. */
export function platformLabel(p: RwaPlatform): string {
  return PLATFORM_LABEL[p];
}

export interface IssuerDiff {
  ticker: string;
  cheaper: RwaPlatform;
  pricier: RwaPlatform;
  /** Always >= 0: the pricier issuer's price minus the cheaper issuer's price. */
  diffUsd: number;
  /** diffUsd relative to the cheaper price, in percent. */
  diffPct: number;
  cheaperBuyable: boolean;
  pricierBuyable: boolean;
}

export type VenuePriceLike = Pick<VenueView, "platform" | "tokenPrice" | "buyable"> & { gapPct?: number | null };

/**
 * The single "which issuer is better for a buyer" rule (design critique P1 #7), shared by the
 * catalog's `bestVenue` (rwaCatalog.ts), the board (`issuerDifference`/`cheaperIssuerNow`) and
 * so the Buy button: ignoring buyability, the lower signed gap against the real share wins —
 * most below, or least above. Without a gap on both sides, the lower token price.
 */
function compareCost(a: VenuePriceLike, b: VenuePriceLike): number {
  const ga = a.gapPct ?? null;
  const gb = b.gapPct ?? null;
  if (ga !== null && gb !== null && ga !== gb) return ga - gb;
  if (ga !== null && gb === null) return -1;
  if (ga === null && gb !== null) return 1;
  return a.tokenPrice - b.tokenPrice;
}

/** Sort comparator: buyable first, then `compareCost`. `[...venues].sort(compareForBuyer)[0]` is the pick. */
export function compareForBuyer(a: VenuePriceLike, b: VenuePriceLike): number {
  if (a.buyable !== b.buyable) return a.buyable ? -1 : 1;
  return compareCost(a, b);
}

/** Board rows under this difference read "About the same price" and sit in their own group. */
export const ABOUT_SAME_PRICE_PCT = 0.1;

export function isAboutSamePrice(row: Pick<IssuerDiff, "diffPct">): boolean {
  return row.diffPct < ABOUT_SAME_PRICE_PCT;
}

/**
 * The difference between bStock and Ondo for one ticker, from whichever venues it has right
 * now. Null when the ticker isn't dual-listed at this moment (only one platform present) —
 * xStocks-style single-issuer rows, or a twin that dropped out of the live catalog, have
 * nothing to compare against.
 */
export function issuerDifference(ticker: string, venues: readonly VenuePriceLike[]): IssuerDiff | null {
  const bstock = venues.find((v) => v.platform === "bstock");
  const ondo = venues.find((v) => v.platform === "ondo");
  if (!bstock || !ondo) return null;

  const bIsCheaper = compareCost(bstock, ondo) <= 0;
  const cheaper = bIsCheaper ? bstock : ondo;
  const pricier = bIsCheaper ? ondo : bstock;
  // Floored at 0: with two different reference prices the cheaper-vs-the-real-share issuer can
  // cost a hair more in dollars, which reads as "About the same price", never a negative gap.
  const diffUsd = Math.max(0, pricier.tokenPrice - cheaper.tokenPrice);

  return {
    ticker,
    cheaper: cheaper.platform,
    pricier: pricier.platform,
    diffUsd,
    diffPct: cheaper.tokenPrice > 0 ? (diffUsd / cheaper.tokenPrice) * 100 : 0,
    cheaperBuyable: cheaper.buyable,
    pricierBuyable: pricier.buyable,
  };
}

/**
 * The board: every currently dual-listed ticker's issuer difference, largest gap first.
 * Tickers with only one venue right now (buildCatalog already drops a venue whose address
 * isn't in the live pull) simply don't have anything to rank and are left out, same as an
 * `issuerDifference` caller would see.
 */
export function rankIssuerBoard(
  tickers: readonly { ticker: string; venues: readonly VenuePriceLike[] }[],
): IssuerDiff[] {
  const rows: IssuerDiff[] = [];
  for (const t of tickers) {
    const diff = issuerDifference(t.ticker, t.venues);
    if (diff) rows.push(diff);
  }
  return rows.sort((a, b) => b.diffUsd - a.diffUsd);
}

/**
 * The plain sentence one board row reads as: "Ondo is $2.30 cheaper (0.7%) · open now", or
 * "About the same price" under 0.1% (design critique P2 #14).
 */
export function issuerDiffSentence(row: Pick<IssuerDiff, "cheaper" | "pricier" | "diffUsd" | "diffPct" | "cheaperBuyable">): string {
  if (isAboutSamePrice(row)) return "About the same price";
  const open = row.cheaperBuyable ? "open now" : "not open right now";
  return `${PLATFORM_LABEL[row.cheaper]} is $${row.diffUsd.toFixed(2)} cheaper (${row.diffPct.toFixed(1)}%) · ${open}`;
}

/**
 * Which issuer a viewer should buy from right now: the cheaper of the two, but only among the
 * issuers actually buyable — a lower price nobody can act on loses to a higher price that's
 * open. With neither buyable (or with no venue at all) it falls back to the plain cheaper
 * price, or null when there's no bStock/Ondo venue to compare.
 */
export function cheaperIssuerNow(venues: readonly VenuePriceLike[]): RwaPlatform | null {
  const candidates = venues.filter((v): v is VenuePriceLike & { platform: RwaPlatform } => v.platform === "bstock" || v.platform === "ondo");
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareForBuyer)[0].platform;
}

/** One venue's recorded point in a ticker's price-vs-real-share history (Redis via spreadStore.ts). */
export interface SpreadPoint {
  /** Epoch ms of the snapshot. */
  t: number;
  tokenPrice: number;
  referencePrice: number;
  gapPct: number | null;
  buyable: boolean;
  state: MarketState;
}

/** How far either side of the real share's price the chart always shows, at minimum. */
const CHART_MIN_PAD = 0.02;

/**
 * PriceVsRealShare's y-domain: the points' own range, widened to at least ±2% of the latest
 * real-share price, so a $1 wobble on a $180 share draws as the small move it is instead of
 * filling the chart (design critique P1 #8).
 */
export function realShareChartDomain(points: readonly Pick<SpreadPoint, "tokenPrice" | "referencePrice">[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 1 };
  const values = points.flatMap((p) => [p.tokenPrice, p.referencePrice]);
  const ref = points[points.length - 1].referencePrice;
  const lo = Math.min(...values, ref * (1 - CHART_MIN_PAD));
  const hi = Math.max(...values, ref * (1 + CHART_MIN_PAD));
  return hi > lo ? { min: lo, max: hi } : { min: lo - 1, max: hi + 1 };
}

export interface SpreadVenueHistory {
  platform: RwaPlatform;
  points: SpreadPoint[];
}

/** `GET /api/rwa/spread/[ticker]?chain=bsc`'s payload. */
export interface SpreadTickerHistoryResponse {
  ticker: string;
  venues: SpreadVenueHistory[];
}

export interface SpreadBoardRow extends IssuerDiff {
  sentence: string;
}

/** One venue's premium/discount call as the board API reports it. */
export interface SpreadVenueCall {
  platform: RwaPlatform;
  call: SpreadCall;
}

/**
 * One ticker's per-venue calls plus which issuer to buy from right now (brief ideas 2 and 3).
 * Present for every catalog ticker, including a single-issuer one — `cheaperIssuer` is only
 * null when there's nothing to compare (see `cheaperIssuerNow`), never because the ticker was
 * left out.
 */
export interface SpreadTickerCall {
  ticker: string;
  venues: SpreadVenueCall[];
  cheaperIssuer: RwaPlatform | null;
}

/** `GET /api/rwa/spread?chain=bsc`'s payload. */
export interface SpreadBoardResponse {
  asOf: number;
  /** Dual-listed tickers only, ranked by the issuer gap — the "who's cheaper" board. */
  board: SpreadBoardRow[];
  /** Every catalog ticker's premium/discount call, including single-issuer ones. */
  tickers: SpreadTickerCall[];
}
