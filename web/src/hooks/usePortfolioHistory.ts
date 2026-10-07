"use client";

// usePortfolioHistory(address, range) — cost basis + gains per holding and the
// account's value over the range, from /api/portfolio/history (server-valued;
// rendered verbatim). Keyed by chain + address + range, fresh for 60 s;
// keepPreviousData makes range switches seamless. Demo: seeded lots, no fetch.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import { useDemo } from "@/components/demo/DemoProvider";
import type { MarketRange } from "@/hooks/useMarket";
import type { HistoryTotals, PositionHistory, SeriesPoint } from "@/lib/positions";

export type { PositionHistory, HistoryTotals, SeriesPoint };

export interface PortfolioHistory {
  positions: PositionHistory[];
  /** Account value over the range, ≤ 61 points, `t` in ms; ends at live prices. */
  series: SeriesPoint[];
  /** Unix seconds when price history starts (null = none yet). Ranges before it are partial. */
  coverageFrom: number | null;
  totals: HistoryTotals;
  cashUsd: number;
}

const RANGE_SPAN_S: Record<MarketRange, number> = {
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1M": 30 * 86_400,
  "1Y": 365 * 86_400,
  "5Y": 5 * 365 * 86_400,
};

/** True when the range starts after price history began (the range P&L is complete). */
export function rangeCovered(coverageFrom: number | null, range: MarketRange, nowMs = Date.now()): boolean {
  if (coverageFrom === null) return false;
  return nowMs / 1000 - RANGE_SPAN_S[range] >= coverageFrom;
}

/** "Sep 6" — when history starts, for the partial-coverage notes. */
export function coverageLabel(coverageFrom: number): string {
  return new Date(coverageFrom * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function fetchHistory(address: string, range: MarketRange): Promise<PortfolioHistory> {
  const res = await authedFetch(`/api/portfolio/history?address=${address}&range=${range}`);
  const json = await res.json();
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load your history.");
  return {
    positions: json.positions ?? [],
    series: json.series ?? [],
    coverageFrom: typeof json.coverageFrom === "number" ? json.coverageFrom : null,
    totals: json.totals ?? { costBasisUsd: 0, unrealizedUsd: 0, realizedUsd: 0 },
    cashUsd: Number(json.cashUsd) || 0,
  };
}

export function usePortfolioHistory(address: string | undefined, range: MarketRange) {
  const demo = useDemo();
  const chain = useChain();
  const query = useQuery({
    queryKey: ["portfolio-history", chain.key, address, range],
    enabled: !demo && Boolean(address),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    queryFn: () => fetchHistory(address as string, range),
  });
  if (demo) {
    return { ...query, data: demo.history(range), isLoading: false, isPending: false } as typeof query;
  }
  return query;
}
