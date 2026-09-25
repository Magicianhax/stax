import "server-only";

// Next earnings date for the 42 BSC stocks (brief idea 6: "Vera can buy before earnings and
// sell after"). Fed to GET /api/earnings; see wiringNeeded in the stream's notes for how
// AssetDetailScreen and the rules evaluator should consume the result.
//
// Source, checked in this order and recorded here rather than re-derived by a future reader:
//  1. Binance's RWA Data API — no earnings/event field anywhere in `/underlying-profile` or
//     `/underlying-market` (docs/BINANCE-WEB3.md §"underlying-profile"/"underlying-market"; the
//     `tabId=3 "Upcoming Earnings"` sector filter is also confirmed dead — every `tabId` returns
//     the same unfiltered rows). Binance is not a source for this at all.
//  2. Yahoo Finance's own calendar JSON API (`/v10/finance/quoteSummary?modules=calendarEvents`,
//     the same family `lib/server/marketData.ts` already calls for chart history) now requires a
//     session crumb: a plain unauthenticated GET returns `401 {"error":{"code":"Unauthorized",
//     "description":"Invalid Crumb"}}` for every ticker (confirmed live 2026-09-25, see the DX
//     log) — a change from when marketData.ts's sibling `/v8/finance/chart` endpoint was proven
//     keyless. No key or cookie flow fits this stream's scope.
//  3. Yahoo's own quote PAGE (`https://finance.yahoo.com/quote/<TICKER>/`) still server-renders
//     the same `calendarEvents` data as escaped JSON inside a `<script>` tag, reachable with a
//     plain `fetch` + a browser User-Agent, no crumb, no cookie (confirmed live 2026-09-25 for
//     NVDA/MSFT/TSLA — see liveFindings). This is the source. It's HTML-scraping of a page
//     Yahoo could reshape at any time, which is why a failed call ultimately surfaces to callers
//     as `null` rather than throwing (see `cachedEarnings`'s doc comment for why the failure
//     itself is a rejection, not a resolved value, until it crosses that boundary), and why the
//     parse itself (`parseYahooEarningsHtml`) is a small pure function a fixture can pin
//     independent of the network.
//
// `isEarningsDateEstimate` is Yahoo's own word for "announced" vs. "our estimate" — that maps
// directly onto `confirmed`, so this module only ever relays what the source already knows,
// never computes its own guess from past report dates (that would be exactly the invented date
// the plan rules out).
import { cached } from "@/lib/server/cache";
import type { EarningsInfo, EarningsMap } from "@/lib/earnings";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const REQUEST_TIMEOUT_MS = 8_000;
/** Earnings dates don't move hour to hour; 12h matches the wave-5 plan's own number for this
 *  stream and keeps a 42-ticker refresh off the request path almost always. */
const EARNINGS_TTL_SECONDS = 12 * 60 * 60;
/** Yahoo's quote page is ~1MB of SSR JSON; this keeps a full-catalog refresh from opening 40+
 *  connections to a source with no key and no budget of its own to lean on. */
const FETCH_CONCURRENCY = 6;

// The ETFs among the 42 BSC stocks (web/src/lib/chains/bsc.assets.ts's names: "Invesco QQQ
// Trust", "SPDR S&P 500 ETF Trust", two leveraged funds, an iShares fund and a themed ETF) — a
// fund has no earnings report of its own. Confirmed live: QQQ's quote page carries no
// `earningsDate` field at all, so skipping these here only saves a fetch Yahoo would answer with
// nothing anyway.
const ETF_SYMBOLS = new Set(["QQQ", "SPY", "SOXL", "TQQQ", "EWY", "DRAM"]);

const NOT_APPLICABLE: EarningsInfo = { nextMs: null, confirmed: false, source: "not-applicable" };
const UNAVAILABLE: EarningsInfo = { nextMs: null, confirmed: false, source: "unavailable" };

// Matches the calendarEvents.earnings fragment inside the page's escaped SSR JSON, e.g.
// `\"earningsDate\":[{\"raw\":1794945600,\"fmt\":\"2026-11-17\"}],\"isEarningsDateEstimate\":false`.
// Deliberately narrow (exactly this key sequence) rather than a loose "find some raw/fmt pair" —
// a false match elsewhere in a 1MB page would be a silently wrong date, which is worse than the
// honest "unavailable" a non-match gives.
const EARNINGS_RE =
  /\\"earningsDate\\":\[\{\\"raw\\":(\d+),\\"fmt\\":\\"[^"\\]+\\"\}\],\\"isEarningsDateEstimate\\":(true|false)/;

/** Pure parse of one quote page's HTML. Exported so a fixture pins the shape without a fetch. */
export function parseYahooEarningsHtml(html: string): { nextMs: number; confirmed: boolean } | null {
  const m = EARNINGS_RE.exec(html);
  if (!m) return null;
  const rawSeconds = Number(m[1]);
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) return null;
  return { nextMs: rawSeconds * 1000, confirmed: m[2] === "false" };
}

/**
 * Throws on any failure (non-2xx, timeout, DNS, a reshaped page) instead of resolving to
 * UNAVAILABLE. That's deliberate: `cachedEarnings` below relies on `cached()` never caching a
 * rejection (cache.ts: "fn rejections are not cached"), so a transient failure costs a retry on
 * the next call instead of being written to Redis as a 12h-long false "no date" for a ticker
 * Yahoo actually has one for.
 */
async function fetchYahooEarnings(symbol: string): Promise<EarningsInfo> {
  const res = await fetch(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`yahoo earnings ${symbol}: HTTP ${res.status}`);
  const parsed = parseYahooEarningsHtml(await res.text());
  if (!parsed) throw new Error(`yahoo earnings ${symbol}: page had no calendarEvents match`);
  return { nextMs: parsed.nextMs, confirmed: parsed.confirmed, source: "yahoo" };
}

/** One entry, cached independently per ticker (same idiom as marketData.ts's `getHistory`), so
 *  a cold ticker among 41 warm ones costs one fetch, not a whole-catalog refetch.
 *
 *  Only a successful parse is ever written to the cache — see `fetchYahooEarnings`'s doc comment.
 *  The `.catch` here is what turns an uncached rejection into the honest, un-cached UNAVAILABLE
 *  the rest of this module expects; it must stay outside the `cached()` call, not inside
 *  `fetchYahooEarnings`, or a failure would resolve instead of reject and get cached again. */
function cachedEarnings(symbol: string): Promise<EarningsInfo> {
  return cached(`earnings:${symbol}`, EARNINGS_TTL_SECONDS, () => fetchYahooEarnings(symbol)).catch(
    () => UNAVAILABLE,
  );
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Next earnings date for each of `symbols`. Best-effort end to end: a paused source, a 404, a
 * timeout or an unfamiliar page shape all resolve that one ticker to `nextMs: null` and never
 * throw or drop the rest of the batch. Never returns a guessed date — see the module doc
 * comment's source note.
 */
export async function getNextEarnings(symbols: string[]): Promise<EarningsMap> {
  const unique = [...new Set(symbols)];
  const entries = await mapWithConcurrency(unique, FETCH_CONCURRENCY, async (symbol) => {
    const info = ETF_SYMBOLS.has(symbol) ? NOT_APPLICABLE : await cachedEarnings(symbol);
    return [symbol, info] as const;
  });
  return Object.fromEntries(entries);
}
