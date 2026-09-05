"use client";

// useBasketPerformance — REAL basket returns from what already exists:
//   1D  → /api/market day summary (dayChangePct per symbol)
//   1W/1M → /api/market?symbol=&range= per holding (react-query, shared with the
//           asset screen's cache), basket return = Σ weight × symbol return
//   spark → weighted, start-normalized blend of the 1M series
//   since → personal baskets: return since `createdAt`, read off the nearest
//           point of the history series that covers that age
//
// Never fabricates: a range is `null` unless EVERY holding has data for it, and
// the screens render "Not enough history yet" for null. Demo mode uses the demo
// series so the landing phones stay offline.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { useDemo } from "@/components/demo/DemoProvider";
import { authedFetch } from "@/lib/authedFetch";
import type { MarketHistoryResponse, MarketRange } from "@/hooks/useMarket";
import { useMarketSummary } from "@/hooks/useMarket";
import { demoHistory } from "@/lib/demo/demoData";
import type { Basket } from "@/lib/baskets";

export type PerfRange = "1D" | "1W" | "1M";

export interface BasketPerformance {
  /** % return per range; null when any holding lacks data. */
  returns: Record<PerfRange, number | null>;
  /** Blended, start-normalized 1M series for a sparkline (null when incomplete). */
  spark: number[] | null;
  /** Personal baskets: % since `createdAt`; null otherwise / not computable. */
  sinceSaved: number | null;
  loading: boolean;
}

const RANGE_SECONDS: Record<MarketRange, number> = {
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1M": 30 * 86_400,
  "1Y": 365 * 86_400,
  All: 5 * 365 * 86_400,
};

async function fetchHistory(symbol: string, range: MarketRange): Promise<MarketHistoryResponse> {
  const res = await authedFetch(`/api/market?symbol=${encodeURIComponent(symbol)}&range=${range}`);
  const json = await res.json();
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load history.");
  return json as MarketHistoryResponse;
}

/** Even resample to `n` points (keeps first + last) so series of different lengths can blend. */
function resample(series: number[], n: number): number[] {
  if (series.length <= 1) return series;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(series[Math.round((i * (series.length - 1)) / (n - 1))]);
  return out;
}

function weightedReturn(items: Basket["items"], byPct: Map<string, number | null>): number | null {
  let total = 0;
  for (const i of items) {
    const r = byPct.get(i.symbol);
    if (r === null || r === undefined || !Number.isFinite(r)) return null;
    total += (i.weightPct / 100) * r;
  }
  return total;
}

// Expressed as "$100 invested at the start" so the chart's magnitude reads like a
// price line (PriceChart's smoothing is tuned for dollar-scale series).
function blendSpark(items: Basket["items"], series: Map<string, number[] | null>, n = 24): number[] | null {
  const out = new Array<number>(n).fill(0);
  for (const i of items) {
    const s = series.get(i.symbol);
    if (!s || s.length < 2 || !(s[0] > 0)) return null;
    const rs = resample(s, n);
    for (let k = 0; k < n; k++) out[k] += i.weightPct * (rs[k] / s[0]);
  }
  return out;
}

/** Return since a point `ageSeconds` ago, read off the series that covers that age (nearest point). */
function returnSince(series: number[], range: MarketRange, ageSeconds: number): number | null {
  if (series.length < 2) return null;
  const span = RANGE_SECONDS[range];
  const idx = Math.round(((span - Math.min(ageSeconds, span)) / span) * (series.length - 1));
  const start = series[Math.max(0, Math.min(series.length - 1, idx))];
  const last = series[series.length - 1];
  if (!(start > 0)) return null;
  return (last / start - 1) * 100;
}

function rangeCovering(ageSeconds: number): MarketRange {
  if (ageSeconds <= RANGE_SECONDS["1D"]) return "1D";
  if (ageSeconds <= RANGE_SECONDS["1W"]) return "1W";
  if (ageSeconds <= RANGE_SECONDS["1M"]) return "1M";
  if (ageSeconds <= RANGE_SECONDS["1Y"]) return "1Y";
  return "All";
}

export function useBasketPerformance(basket: Basket | undefined): BasketPerformance {
  const chain = useChain();
  const demo = useDemo();
  const qc = useQueryClient();
  const summary = useMarketSummary();
  const symbols = basket?.items.map((i) => i.symbol) ?? [];
  const personal = basket?.author === "you";
  // "Now" is fixed for the life of the hook — good enough for a "since you saved it" age.
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const ageSeconds = basket ? Math.max(0, now - basket.createdAt) : 0;
  const sinceRange = rangeCovering(ageSeconds);

  // One query per basket (spec key), which in turn shares the per-symbol history
  // cache with the asset screens so ten baskets never fetch Nvidia ten times.
  const history = useQuery({
    queryKey: ["basket-perf", chain.key, basket?.id ?? "", demo ? "demo" : "live", personal ? sinceRange : "-"],
    enabled: Boolean(basket) && symbols.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const ranges: MarketRange[] = personal ? ["1W", "1M", sinceRange] : ["1W", "1M"];
      const uniqueRanges = [...new Set(ranges)];
      const load = (symbol: string, range: MarketRange) =>
        demo
          ? Promise.resolve(demoHistory(symbol, range))
          : qc.fetchQuery({
              queryKey: ["market-history", chain.key, symbol, range],
              queryFn: () => fetchHistory(symbol, range),
              staleTime: 60_000,
            });
      const results = await Promise.all(
        uniqueRanges.map(async (range) => {
          const rows = await Promise.all(
            symbols.map(async (symbol) => {
              try {
                const h = await load(symbol, range);
                return [symbol, h.changePct ?? null, h.series ?? null] as const;
              } catch {
                return [symbol, null, null] as const;
              }
            }),
          );
          return [range, rows] as const;
        }),
      );
      const out: Partial<Record<MarketRange, { pct: Map<string, number | null>; series: Map<string, number[] | null> }>> = {};
      for (const [range, rows] of results) {
        out[range] = {
          pct: new Map(rows.map((r) => [r[0], r[1]])),
          series: new Map(rows.map((r) => [r[0], r[2]])),
        };
      }
      return out;
    },
  });

  if (!basket) {
    return { returns: { "1D": null, "1W": null, "1M": null }, spark: null, sinceSaved: null, loading: false };
  }

  // 1D from the day summary (already cached for the market/portfolio rows).
  const dayMap = new Map<string, number | null>();
  for (const s of symbols) {
    const live = summary.data?.summary[s];
    dayMap.set(s, demo ? demoHistory(s, "1D").changePct : live ? live.dayChangePct : null);
  }
  const h = history.data;
  const returns: Record<PerfRange, number | null> = {
    "1D": weightedReturn(basket.items, dayMap),
    "1W": h?.["1W"] ? weightedReturn(basket.items, h["1W"].pct) : null,
    "1M": h?.["1M"] ? weightedReturn(basket.items, h["1M"].pct) : null,
  };
  const spark = h?.["1M"] ? blendSpark(basket.items, h["1M"].series) : null;

  let sinceSaved: number | null = null;
  if (personal && h?.[sinceRange]) {
    const per = new Map<string, number | null>();
    for (const i of basket.items) {
      const s = h[sinceRange]?.series.get(i.symbol);
      per.set(i.symbol, s ? returnSince(s, sinceRange, ageSeconds) : null);
    }
    sinceSaved = weightedReturn(basket.items, per);
  }

  return { returns, spark, sinceSaved, loading: history.isLoading || (!demo && summary.isLoading) };
}
