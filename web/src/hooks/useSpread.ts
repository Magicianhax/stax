"use client";

// useSpread — the bStock-vs-Ondo board (`GET /api/rwa/spread?chain=bsc`) and one ticker's
// price-vs-real-share history (`GET /api/rwa/spread/[ticker]?chain=bsc`). Same shape as
// hooks/useRwa.ts: disabled off BSC (there is nothing to compare there), react-query owns the
// caching, and every actual rule about the numbers already lives in lib/spread.ts — this is a
// thin fetcher, nothing more.
import { useQuery } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import type { SpreadBoardResponse, SpreadTickerHistoryResponse } from "@/lib/spread";

async function fetchJson<T>(url: string, fallback: string): Promise<T> {
  const res = await authedFetch(url);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : fallback);
  }
  return json as T;
}

/** The full bStock-vs-Ondo board. Disabled — `data` stays undefined — on every chain but BSC. */
export function useSpreadBoard() {
  const chain = useChain();
  const enabled = chain.key === "bsc";
  return useQuery({
    queryKey: ["rwa-spread-board", chain.key],
    queryFn: () => fetchJson<SpreadBoardResponse>("/api/rwa/spread?chain=bsc", "Couldn't load the issuer board."),
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 60_000 : false,
  });
}

/** One ticker's price-vs-real-share history, per issuer. Disabled without a ticker, or off BSC. */
export function useSpreadHistory(ticker: string | undefined) {
  const chain = useChain();
  const enabled = chain.key === "bsc" && Boolean(ticker);
  return useQuery({
    queryKey: ["rwa-spread-history", chain.key, ticker],
    queryFn: () =>
      fetchJson<SpreadTickerHistoryResponse>(
        `/api/rwa/spread/${encodeURIComponent(ticker as string)}?chain=bsc`,
        "Couldn't load this stock's price history.",
      ),
    enabled,
    staleTime: 60_000,
  });
}
