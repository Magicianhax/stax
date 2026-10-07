import "server-only";

// Turns a raw Binance RWA `/tokens` pull into the view models the Market screen, Vera and
// `/api/rwa` all read: one row per curated ticker, both issuers side by side when both list it,
// and the venue a buy should use right now (docs/BINANCE-WEB3.md §2, §7).
import { BSC } from "../chains/bsc";
import type { Asset } from "../chains/types";
import type { RwaPlatform } from "../chains";
import { nextUsOpenMs, usMarketState } from "../marketHours";
import { compareForBuyer } from "../spread";
import {
  gapPct,
  venueBuyable,
  venueState,
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

/** A pull older than this is outage-fallback data, not a normal read (the cache holds one for ~45 s, plus the Binance client's own ~45 s). */
const STALE_TOKENS_MS = 3 * 60_000;

function buildVenue(token: RwaToken, nowMs: number, fetchedAtMs: number, sessionCrossed: boolean): VenueView {
  let state = venueState(token.statusInfo, nowMs);
  let buyable = venueBuyable(token.statusInfo, nowMs);
  // The pull is from before a US session boundary (a Binance outage kept serving an old snapshot
  // across the 9:30 open or the 16:00 close): the issuer's own open/closed flags describe the old
  // session. Fail closed rather than offer a stale "Open now", and say closed when the calendar does.
  if (sessionCrossed) {
    buyable = false;
    if (usMarketState(nowMs) === "closed") state = "closed";
  }
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
    // "as of" is when the pull was fetched, same as RwaListResponse.asOf.
    updatedAt: fetchedAtMs,
  };
}

/**
 * The venue a buy should use right now: buyable, then the one that costs less against the real
 * share (lib/spread.ts's `compareForBuyer` — the same rule the "Which is cheaper?" board uses,
 * design critique P1 #7). Null when nothing is buyable.
 */
function pickBestVenue(venues: VenueView[]): RwaPlatform | null {
  const buyable = venues.filter((v) => v.buyable);
  if (buyable.length === 0) return null;
  return [...buyable].sort(compareForBuyer)[0].platform;
}

/**
 * One row per curated `assets` entry with an address, built from whichever of its own address
 * and its `twin`'s address `tokens` actually lists — `/tokens` can omit a real, tradable token
 * (docs/BINANCE-WEB3.md §7.2, AAPLB), so a missing venue is dropped rather than failing the
 * whole ticker, and a ticker with no venue at all is left out of the result.
 */
export function buildCatalog(tokens: RwaToken[], assets: Asset[], nowMs: number, fetchedAtMs: number = nowMs): RwaTickerView[] {
  const sessionCrossed = nowMs - fetchedAtMs > STALE_TOKENS_MS && usMarketState(fetchedAtMs) !== usMarketState(nowMs);
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

    const venues = present.map((t) => buildVenue(t, nowMs, fetchedAtMs, sessionCrossed));
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

const TOKENS_KEY = "rwa:tokens:bsc";
const TOKENS_TTL_S = 45; // matches rwaTokens()'s own Redis cache; this layer never calls Binance itself
const TOKENS_FALLBACK_TTL_S = 600;

/**
 * `GET /api/rwa?chain=bsc`'s payload: the curated catalog built from one cached `rwaTokens()`
 * call. `rwaTokens()` already holds the Binance-facing cache (Task 7); the wrapping cache here
 * only exists to keep the last good PULL around for `cachedWithFallback`'s outage path.
 *
 * What is cached is the raw pull, never the built catalog. A catalog bakes in what the clock says
 * (open or closed, buyable or not), so a snapshot built at 15:59:50 ET kept saying "Open now" for
 * minutes after the close, and an outage replayed it for up to ten. The view is rebuilt from the
 * cached tokens on every read, against that read's own `nowMs`; `asOf` stays the pull's time so
 * staleness remains visible.
 */
export async function bscCatalogSnapshot(nowMs: number): Promise<RwaListResponse> {
  const pull = await cachedWithFallback(TOKENS_KEY, TOKENS_TTL_S, TOKENS_FALLBACK_TTL_S, async () => ({
    tokens: await getBinanceWeb3().rwaTokens(),
    at: nowMs,
  }));
  return { tickers: buildCatalog(pull.tokens, BSC.assets.all, nowMs, pull.at), asOf: pull.at };
}

// Profile is near-static company info and candles move slowly at 1h+ bars; both share the one
// 5-per-window Binance budget with live quotes, so they are cached far longer than prices.
const PROFILE_TTL_S = 6 * 3600;
const CANDLES_TTL_S = 300;
const DETAIL_FALLBACK_TTL_S = 24 * 3600; // must outlive PROFILE_TTL_S, or an outage after expiry has nothing to serve

/** `/underlying-profile` for one address, cached with the same stale-on-outage fallback. */
export function cachedRwaProfile(address: `0x${string}`): Promise<unknown> {
  return cachedWithFallback(`binance:rwa:profile:${address}`, PROFILE_TTL_S, DETAIL_FALLBACK_TTL_S, () =>
    getBinanceWeb3().rwaProfile(address),
  );
}

/** `/candles` for one address, cached with the same stale-on-outage fallback. */
export function cachedCandles(address: `0x${string}`, bar: "5m" | "1h" | "4h" | "1d", limit: number) {
  return cachedWithFallback(`binance:rwa:candles:${address}:${bar}:${limit}`, CANDLES_TTL_S, DETAIL_FALLBACK_TTL_S, () =>
    getBinanceWeb3().candles(address, bar, limit),
  );
}
