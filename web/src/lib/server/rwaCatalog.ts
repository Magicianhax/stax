import "server-only";

// Turns a raw Binance RWA `/tokens` pull into the view models the Market screen, Vera and
// `/api/rwa` all read: one row per curated ticker, both issuers side by side when both list it,
// and the venue a buy should use right now (docs/BINANCE-WEB3.md §2, §7).
import { BSC } from "../chains/bsc";
import type { Asset } from "../chains/types";
import type { RwaPlatform } from "../chains";
import { nextUsOpenMs, usMarketState } from "../marketHours";
import {
  gapPct,
  isBuyable,
  marketStateFrom,
  type MarketState,
  type RwaListResponse,
  type RwaTickerView,
  type VenueView,
} from "../rwa";
import { getBinanceWeb3 } from "./binance";
import type { RwaToken } from "./binance/types";
import { cached, cacheDel } from "./cache";

/** 1 = stock, 3 = ETF (docs/BINANCE-WEB3.md §2); 2 (pre-IPO) has never been seen live. */
function tickerType(assetType: RwaToken["assetType"]): RwaTickerView["type"] {
  if (assetType === 1) return "stock";
  if (assetType === 3) return "etf";
  return "other";
}

/**
 * The next-open instant for a non-buyable venue. bStock rows never report their own session
 * (`nextOpenTime` is always null), so they always use Stax's own NYSE calendar. Ondo rows trust
 * `nextOpenTime` — except while the row is premarket, when the docs' one live sample showed
 * Ondo's own session times contradicting each other (nextCloseTime preceded nextOpenTime), so
 * the same calendar is used there too rather than repeat an unreliable field.
 */
function nextOpenMsFor(platform: RwaPlatform, state: MarketState, nextOpenTime: number | null, nowMs: number): number {
  if (platform === "bstock") return nextUsOpenMs(nowMs);
  if (state !== "premarket" && nextOpenTime !== null && nextOpenTime > nowMs) return nextOpenTime;
  return nextUsOpenMs(nowMs);
}

/**
 * `state` for one row. `marketStateFrom` reads the API's own session — bStock's statusInfo
 * carries no session at all (`marketStatus` always null) so it always falls through, but so
 * does an Ondo row that gives no session either, and both need the same two fallbacks in
 * order: first, a non-TRADING reason the issuer already flagged as not open (`openState`
 * false) is Stax's own "paused" state, not a guess — e.g. bStock's MARKET_PAUSED/ASSET_PAUSED
 * days, which used to read as whatever the US clock said, TRADING reason or not. Only when
 * the row gives no signal at all does the US-hours calendar stand in.
 */
function stateFor(token: RwaToken, nowMs: number): MarketState {
  const fromApi = marketStateFrom(token.statusInfo);
  if (fromApi !== null) return fromApi;
  if (!token.statusInfo.openState && token.statusInfo.reasonCode !== "TRADING") return "paused";
  return usMarketState(nowMs);
}

function buildVenue(token: RwaToken, nowMs: number): VenueView {
  const state = stateFor(token, nowMs);
  // `state` and `isBuyable` come from independent signals (the calendar vs. the issuer's own
  // flags) and can disagree — an issuer that still claims TRADING after Stax's own clock says
  // the market is closed must never read as buyable: that is exactly the weekend-premium buy
  // Vera is supposed to refuse. The calendar wins.
  const buyable = state === "closed" ? false : isBuyable(token.statusInfo);
  return {
    platform: token.platformId,
    symbol: token.tokenSymbol,
    address: token.tokenContractAddress,
    tokenPrice: token.tokenPrice,
    referencePrice: token.referencePrice,
    gapPct: gapPct(token.tokenPrice, token.referencePrice),
    state,
    buyable,
    nextOpenMs: buyable ? null : nextOpenMsFor(token.platformId, state, token.statusInfo.nextOpenTime, nowMs),
    // /tokens carries no per-row timestamp; the whole pull is one snapshot, so every venue's
    // "as of" is the moment the catalog was built, same as RwaListResponse.asOf.
    updatedAt: nowMs,
  };
}

/** The buyable venue with the smallest |gap|; a venue with no usable gap sorts last. */
function pickBestVenue(venues: VenueView[]): RwaPlatform | null {
  const buyable = venues.filter((v) => v.buyable);
  if (buyable.length === 0) return null;
  let best = buyable[0];
  let bestGap = best.gapPct === null ? Infinity : Math.abs(best.gapPct);
  for (const v of buyable.slice(1)) {
    const gap = v.gapPct === null ? Infinity : Math.abs(v.gapPct);
    if (gap < bestGap) {
      best = v;
      bestGap = gap;
    }
  }
  return best.platform;
}

/**
 * One row per curated `assets` entry with an address, built from whichever of its own address
 * and its `twin`'s address `tokens` actually lists — `/tokens` can omit a real, tradable token
 * (docs/BINANCE-WEB3.md §7.2, AAPLB), so a missing venue is dropped rather than failing the
 * whole ticker, and a ticker with no venue at all is left out of the result.
 */
export function buildCatalog(tokens: RwaToken[], assets: Asset[], nowMs: number): RwaTickerView[] {
  const byAddress = new Map<string, RwaToken>();
  for (const t of tokens) byAddress.set(t.tokenContractAddress.toLowerCase(), t);

  const out: RwaTickerView[] = [];
  for (const asset of assets) {
    if (!asset.address) continue;
    const present: RwaToken[] = [];
    const defaultToken = byAddress.get(asset.address.toLowerCase());
    if (defaultToken) present.push(defaultToken);
    if (asset.twin) {
      const twinToken = byAddress.get(asset.twin.address.toLowerCase());
      if (twinToken) present.push(twinToken);
    }
    if (present.length === 0) continue;

    const venues = present.map((t) => buildVenue(t, nowMs));
    out.push({
      ticker: asset.symbol,
      name: asset.name,
      type: tickerType(present[0].assetType),
      venues,
      bestVenue: pickBestVenue(venues),
    });
  }
  return out;
}

/**
 * `cached()` drops a value the instant its TTL passes, so a Binance outage right after
 * expiry gets nothing to fall back on. This keeps a second, longer-lived copy of the last
 * value `fn` produced, so a live failure can still serve something real instead of a 503 —
 * and never a fabricated "market closed": Review Focus #1 asks for the honest state, not a
 * guess. The primary slot still does all the normal cache-hit work (this is layered on top
 * of it, not instead of it), so the Binance-facing call rate is unaffected.
 *
 * The fallback slot is only ever refreshed from inside the primary loader — i.e. only on a
 * genuine reload, not on every call — so `cached()`'s own "write only on a miss" rule can't
 * leave it pinned to whichever value happened to be first in some window. `cacheDel` before
 * the write is what makes that a refresh and not another no-op miss-check.
 */
export async function cachedWithFallback<T>(
  key: string,
  ttlSeconds: number,
  fallbackTtlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const fallbackKey = `${key}:lastGood`;
  try {
    return await cached(key, ttlSeconds, async () => {
      const value = await fn();
      await cacheDel(fallbackKey);
      await cached(fallbackKey, fallbackTtlSeconds, async () => value);
      return value;
    });
  } catch (err) {
    return cached(fallbackKey, fallbackTtlSeconds, async () => {
      throw err;
    });
  }
}

const CATALOG_KEY = "rwa:catalog:bsc";
const CATALOG_TTL_S = 45; // matches rwaTokens()'s own Redis cache; this layer never calls Binance itself
const CATALOG_FALLBACK_TTL_S = 600;

/**
 * `GET /api/rwa?chain=bsc`'s payload: the curated catalog built from one cached `rwaTokens()`
 * call. `rwaTokens()` already holds the Binance-facing cache (Task 7); the wrapping cache here
 * only exists to keep the last good snapshot around for `cachedWithFallback`'s outage path, and
 * to avoid rebuilding the view from the same tokens on every request within the window.
 */
export async function bscCatalogSnapshot(nowMs: number): Promise<RwaListResponse> {
  return cachedWithFallback(CATALOG_KEY, CATALOG_TTL_S, CATALOG_FALLBACK_TTL_S, async () => {
    const tokens = await getBinanceWeb3().rwaTokens();
    return { tickers: buildCatalog(tokens, BSC.assets.all, nowMs), asOf: nowMs };
  });
}

const DETAIL_TTL_S = 60;
const DETAIL_FALLBACK_TTL_S = 600;

/** `/underlying-profile` for one address, cached with the same stale-on-outage fallback. */
export function cachedRwaProfile(address: `0x${string}`): Promise<unknown> {
  return cachedWithFallback(`binance:rwa:profile:${address}`, DETAIL_TTL_S, DETAIL_FALLBACK_TTL_S, () =>
    getBinanceWeb3().rwaProfile(address),
  );
}

/** `/candles` for one address, cached with the same stale-on-outage fallback. */
export function cachedCandles(address: `0x${string}`, bar: "5m" | "1h" | "4h" | "1d", limit: number) {
  return cachedWithFallback(`binance:rwa:candles:${address}:${bar}:${limit}`, DETAIL_TTL_S, DETAIL_FALLBACK_TTL_S, () =>
    getBinanceWeb3().candles(address, bar, limit),
  );
}
