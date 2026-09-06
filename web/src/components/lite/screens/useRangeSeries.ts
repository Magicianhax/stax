"use client";

// Range series for the performance surfaces (Owned, Basket detail, Asset detail).
//
//   useSymbolSeries(symbols, range) → { series: Map<symbol, PricePoint[]>, loading }
//     demo → deterministic priceSeries (stable screenshots)
//     real → /api/market history per symbol (react-query, same cache key as
//            useMarketHistory / useBasketPerformance), timestamps spread evenly
//            over the range so the chart readout can show dates.
//   blendSeries(parts, { base, anchor }) → one PricePoint[] from weighted parts
//   changeOf(points) → { abs, pct } first → last
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { useDemo } from "@/components/demo/DemoProvider";
import { authedFetch } from "@/lib/authedFetch";
import type { MarketHistoryResponse, MarketRange } from "@/hooks/useMarket";
import type { PricePoint } from "@/components/design";
import { priceSeries } from "@/lib/demoSeries";

export type { MarketRange };

const DAY = 86_400e3;
const RANGE_SPAN: Record<MarketRange, number> = {
  "1D": DAY,
  "1W": 7 * DAY,
  "1M": 30 * DAY,
  "1Y": 365 * DAY,
  All: 5 * 365 * DAY,
};

async function fetchHistory(symbol: string, range: MarketRange): Promise<MarketHistoryResponse> {
  const res = await authedFetch(`/api/market?symbol=${encodeURIComponent(symbol)}&range=${range}`);
  const json = await res.json();
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load history.");
  return json as MarketHistoryResponse;
}

/** Spread an untimed series evenly over the range, ending at `endMs`. */
export function timeSeries(values: number[], range: MarketRange, endMs: number): PricePoint[] {
  const n = values.length;
  if (n === 0) return [];
  const step = n > 1 ? RANGE_SPAN[range] / (n - 1) : 0;
  return values.map((v, i) => ({ t: Math.round(endMs - (n - 1 - i) * step), v }));
}

const EMPTY = new Map<string, PricePoint[]>();

export function useSymbolSeries(
  symbols: readonly string[],
  range: MarketRange,
): { series: Map<string, PricePoint[]>; loading: boolean } {
  const chain = useChain();
  const demo = useDemo();
  const key = symbols.join(",");
  // Frozen "now" for series whose asOf is missing (pure render).
  const [now] = useState(() => Date.now());

  const queries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["market-history", chain.key, symbol, range],
      enabled: !demo,
      staleTime: 60_000,
      queryFn: () => fetchHistory(symbol, range),
    })),
  });
  const loading = !demo && queries.some((q) => q.isLoading);
  const results = queries.map((q) => q.data ?? null);
  // Only re-blend when a result object actually changes.
  const stamp = results.map((r) => (r ? r.asOf : "-")).join("|");

  const series = useMemo(() => {
    const syms = key ? key.split(",") : [];
    if (!syms.length) return EMPTY;
    const out = new Map<string, PricePoint[]>();
    syms.forEach((s, i) => {
      if (demo) {
        out.set(s, priceSeries(s, range));
        return;
      }
      const r = results[i];
      if (r?.series && r.series.length > 1) {
        out.set(s, timeSeries(r.series, range, Date.parse(r.asOf) || now));
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range, demo, stamp, now]);

  return { series, loading };
}

export interface BlendPart {
  points: PricePoint[];
  /** Dollar value (anchor "end") or weight (anchor "start"). */
  weight: number;
}

/** Even resample by index (keeps first + last). */
function pick<T>(arr: T[], n: number): T[] {
  if (arr.length <= 1 || n <= 1) return arr;
  return Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
}

/**
 * Blend weighted series into one.
 *   anchor "end"   → each part is scaled so its LAST point equals `weight` (a
 *                    holding's current value); `base` (cash) is added flat. The
 *                    blend ends exactly at Σ weight + base.
 *   anchor "start" → each part starts at `weight` (a basket weight in %); the
 *                    blend starts at Σ weight (100 for a basket).
 * Timestamps come from the longest part.
 */
export function blendSeries(
  parts: BlendPart[],
  { base = 0, anchor = "end", n = 40 }: { base?: number; anchor?: "end" | "start"; n?: number } = {},
): PricePoint[] {
  const usable = parts.filter((p) => p.points.length > 1 && p.weight > 0);
  if (!usable.length) return [];
  const longest = usable.reduce((a, b) => (b.points.length > a.points.length ? b : a)).points;
  const count = Math.min(n, longest.length);
  const ts = pick(longest, count).map((p) => p.t);
  const out = new Array<number>(count).fill(base);
  for (const p of usable) {
    const vs = pick(p.points, count).map((x) => x.v);
    const ref = anchor === "end" ? vs[vs.length - 1] : vs[0];
    if (!(ref > 0)) continue;
    for (let k = 0; k < count; k++) out[k] += (p.weight * vs[k]) / ref;
  }
  return out.map((v, k) => ({ t: ts[k], v: Number(v.toFixed(2)) }));
}

/** First → last change of a series. */
export function changeOf(points: { v: number }[]): { abs: number; pct: number } {
  if (points.length < 2) return { abs: 0, pct: 0 };
  const a = points[0].v;
  const b = points[points.length - 1].v;
  return { abs: b - a, pct: a > 0 ? ((b - a) / a) * 100 : 0 };
}

/** Short readout date for a scrubbed point ("Sep 3" or "Sep 3 · 2:15 PM" for intraday). */
export function readoutDate(t: number | string, range: MarketRange): string {
  if (typeof t === "string") return t;
  const d = new Date(t < 1e12 ? t * 1000 : t);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (range === "1D") return `${day} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  if (range === "All" || range === "1Y") return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return day;
}
