// Server-only market history for Stax assets — real charts + real daily moves.
//
//   - Stocks/ETFs (AAPL … SPY, QQQ): Yahoo Finance chart API. Tokenized stocks
//     track real equities and our tickers ARE the real tickers (on every chain),
//     so the underlying market's history is the honest series to draw. The price
//     you trade at is still the on-chain pool spot (/api/prices) — they track closely.
//   - Crypto / yield tokens (BTC, ETH, sUSDe, mETH, FBTC, USDY): CoinGecko charts.
//   - USDC / aUSDC / mUSD: flat $1 series, synthesized (they are dollar pegs).
//
// Everything is cached in-memory per instance (promise-deduped) so a screenful
// of clients costs at most one upstream call per symbol per TTL window.
import type { StaxChain } from "@/lib/chains/types";

export type MarketRange = "1D" | "1W" | "1M" | "1Y" | "5Y";
export const MARKET_RANGES: MarketRange[] = ["1D", "1W", "1M", "1Y", "5Y"];

export interface MarketHistory {
  /** Closing prices, oldest -> newest (USD). */
  series: number[];
  /** % change across the range (1D uses previous close where available). */
  changePct: number;
}

export interface DaySummaryEntry {
  dayChangePct: number;
  /** Downsampled 1D series for row sparklines. */
  spark: number[];
}

// ── tiny TTL cache (promise-deduped, per warm instance) ──────────────────────
const cacheStore = new Map<string, { at: number; value: Promise<unknown> }>();
function ttlCache<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cacheStore.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load().catch((err) => {
    cacheStore.delete(key); // don't cache failures for the whole TTL
    throw err;
  });
  cacheStore.set(key, { at: Date.now(), value });
  return value;
}

// ── source mapping ────────────────────────────────────────────────────────────
function isStock(chain: StaxChain, symbol: string): boolean {
  return chain.assets.stocks.some((s) => s.symbol === symbol);
}

// CoinGecko ids for the non-equity assets (shared across chains — the symbol is
// the same exposure everywhere). FBTC / BTC map to bitcoin itself: it IS BTC
// exposure and CG's data for it is far denser than any wrapper's listing.
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  sUSDe: "ethena-staked-usde",
  mETH: "mantle-staked-ether",
  FBTC: "bitcoin",
  USDY: "ondo-us-dollar-yield",
};

// CoinGecko's public tier stops at 365 days, so the 5Y range for the majors
// comes from Yahoo's crypto tickers instead (same 5y/1wk request as stocks).
const YAHOO_CRYPTO: Record<string, string> = {
  BTC: "BTC-USD",
  FBTC: "BTC-USD",
  ETH: "ETH-USD",
  mETH: "ETH-USD",
};

// Flat dollar pegs — a real fetch would just draw the same line.
const FLAT_DOLLAR = new Set(["USDC", "aUSDC", "mUSD"]);

// ── Yahoo Finance (equities) ──────────────────────────────────────────────────
const YAHOO_RANGES: Record<MarketRange, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
};

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { chartPreviousClose?: number; regularMarketPrice?: number };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

async function yahooHistory(ticker: string, range: MarketRange): Promise<MarketHistory | null> {
  const { range: r, interval } = YAHOO_RANGES[range];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${r}&interval=${interval}`;
  const res = await fetch(url, {
    headers: {
      // Yahoo rejects UA-less requests.
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as YahooChart;
  const result = json.chart?.result?.[0];
  const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter(
    (c): c is number => typeof c === "number" && Number.isFinite(c),
  );
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1];
  // 1D change is vs the previous session's close (the number brokers show),
  // not vs the first intraday tick.
  const base = range === "1D" ? (result?.meta?.chartPreviousClose ?? closes[0]) : closes[0];
  const changePct = base > 0 ? ((last - base) / base) * 100 : 0;
  return { series: closes, changePct };
}

// ── CoinGecko (tokens) ────────────────────────────────────────────────────────
const COINGECKO_DAYS: Record<MarketRange, string> = {
  "1D": "1",
  "1W": "7",
  "1M": "30",
  "1Y": "365",
  "5Y": "365", // unreachable: 5Y crypto goes through YAHOO_CRYPTO (public CG caps at 365 days)
};

async function coingeckoHistory(id: string, range: MarketRange): Promise<MarketHistory | null> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${COINGECKO_DAYS[range]}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { prices?: Array<[number, number]> };
  const series = (json.prices ?? [])
    .map((p) => p[1])
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (series.length < 2) return null;
  const changePct = series[0] > 0 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : 0;
  return { series, changePct };
}

// ── public surface ────────────────────────────────────────────────────────────
/** Evenly downsample a series to at most `n` points (keeps first + last). */
export function downsample(series: number[], n: number): number[] {
  if (series.length <= n) return series;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(series[Math.round((i * (series.length - 1)) / (n - 1))]);
  }
  return out;
}

// Intraday data moves; long ranges don't. Cache accordingly.
const HISTORY_TTL: Record<MarketRange, number> = {
  "1D": 3 * 60_000,
  "1W": 15 * 60_000,
  "1M": 60 * 60_000,
  "1Y": 6 * 60 * 60_000,
  "5Y": 6 * 60 * 60_000,
};

/** Real price history for one asset on `chain`, or null when no source exists / upstream fails. */
export function getHistory(chain: StaxChain, symbol: string, range: MarketRange): Promise<MarketHistory | null> {
  // Stock history is chain-independent (same real ticker), so it's cached without
  // the chain key; token/peg lookups are symbol-keyed too. The chain only decides
  // which source applies.
  return ttlCache(`history:${symbol}:${range}`, HISTORY_TTL[range], async () => {
    if (FLAT_DOLLAR.has(symbol)) return { series: Array(20).fill(1), changePct: 0 };
    if (isStock(chain, symbol)) return yahooHistory(symbol, range);
    const cgId = COINGECKO_IDS[symbol];
    if (cgId) {
      if (range === "5Y") {
        const ticker = YAHOO_CRYPTO[symbol];
        return ticker ? yahooHistory(ticker, range) : null;
      }
      return coingeckoHistory(cgId, range);
    }
    return null;
  });
}

/**
 * 1D change + row sparkline for every asset on `chain` that has a live source.
 * Powers the portfolio rows and the market list. One cached object per chain.
 */
export function getDaySummary(chain: StaxChain): Promise<Record<string, DaySummaryEntry>> {
  return ttlCache(`day-summary:${chain.key}`, 5 * 60_000, async () => {
    const entries = await Promise.all(
      chain.assets.all.map(async (asset) => {
        try {
          const h = await getHistory(chain, asset.symbol, "1D");
          if (!h) return null;
          return [
            asset.symbol,
            { dayChangePct: h.changePct, spark: downsample(h.series, 20) },
          ] as const;
        } catch {
          return null; // one bad upstream never hides the rest
        }
      }),
    );
    const map: Record<string, DaySummaryEntry> = {};
    for (const e of entries) if (e) map[e[0]] = e[1];
    return map;
  });
}
