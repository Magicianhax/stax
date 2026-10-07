"use client";

// useSpread — the bStock-vs-Ondo board (`GET /api/rwa/spread?chain=bsc`) and one ticker's
// price-vs-real-share history (`GET /api/rwa/spread/[ticker]?chain=bsc`). Same shape as
// hooks/useRwa.ts: disabled off BSC (there is nothing to compare there), react-query owns the
// caching, and every actual rule about the numbers already lives in lib/spread.ts — this is a
// thin fetcher, nothing more.
import { useQuery } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import { useDemo } from "@/components/demo/DemoProvider";
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
  const demo = useDemo();
  const enabled = chain.key === "bsc" && !demo;
  const query = useQuery({
    queryKey: ["rwa-spread-board", chain.key],
    queryFn: () => fetchJson<SpreadBoardResponse>("/api/rwa/spread?chain=bsc", "Couldn't load the issuer board."),
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 60_000 : false,
  });
  if (demo?.spreadBoard) return { ...query, data: demo.spreadBoard, isLoading: false, isPending: false, isError: false, error: null } as typeof query;
  return query;
}

/** One ticker's price-vs-real-share history, per issuer. Disabled without a ticker, or off BSC. */
export function useSpreadHistory(ticker: string | undefined) {
  const chain = useChain();
  const demo = useDemo();
  const enabled = chain.key === "bsc" && Boolean(ticker) && !demo;
  const query = useQuery({
    queryKey: ["rwa-spread-history", chain.key, ticker],
    queryFn: () =>
      fetchJson<SpreadTickerHistoryResponse>(
        `/api/rwa/spread/${encodeURIComponent(ticker as string)}?chain=bsc`,
        "Couldn't load this stock's price history.",
      ),
    enabled,
    staleTime: 60_000,
  });
  if (demo && chain.key === "bsc" && ticker) {
    const data = demo.spreadHistory(ticker) ?? undefined;
    return { ...query, data, isLoading: false, isPending: false, isError: false, error: null } as typeof query;
  }
  return query;
}
