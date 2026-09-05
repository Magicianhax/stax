"use client";

// useMarket — REAL price history from /api/market (Yahoo Finance for the
// equities our tokenized stocks track, CoinGecko for the token tier; cached
// server-side). Keyed by the active chain: each network lists its own assets.
//
//   useMarketHistory(symbol, range) -> { series, changePct } for the detail chart
//   useMarketSummary()              -> 1D change + spark per symbol (market rows)
//
// series/changePct are null when the asset has no live source or the upstream
// is down — callers fall back to the presentational reference, never blank.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";

export type MarketRange = "1D" | "1W" | "1M" | "1Y" | "All";

export interface MarketHistoryResponse {
  series: number[] | null;
  changePct: number | null;
  asOf: string;
}

export interface MarketSummaryResponse {
  summary: Record<string, { dayChangePct: number; spark: number[] }>;
  asOf: string;
}

async function getJson<T>(url: string, fallbackError: string): Promise<T> {
  const res = await authedFetch(url);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : fallbackError);
  }
  return json as T;
}

/** Real chart series for one asset + range. keepPreviousData makes range switches seamless. */
export function useMarketHistory(symbol: string | undefined, range: MarketRange) {
  const chain = useChain();
  return useQuery({
    queryKey: ["market-history", chain.key, symbol, range],
    enabled: Boolean(symbol),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: () =>
      getJson<MarketHistoryResponse>(
        `/api/market?symbol=${symbol}&range=${range}`,
        "Couldn't load the chart.",
      ),
  });
}

/** Real 1D change + sparkline for every asset on the active chain (market list rows). */
export function useMarketSummary() {
  const chain = useChain();
  return useQuery({
    queryKey: ["market-summary", chain.key],
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: () =>
      getJson<MarketSummaryResponse>("/api/market", "Couldn't load market data."),
  });
}
