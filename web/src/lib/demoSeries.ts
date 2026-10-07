// Deterministic demo series for charts — seeded per symbol/range so every render
// (and every screenshot) is identical. Anchored to a fixed "now" (DEMO_NOW) so
// readout dates are stable too. Presentational only; nothing here touches chain
// or market data.
//
//   priceSeries("NVDA", "1M")           → { t, v }[] ending at the display price
//   portfolioSeries("1Y", 2752.55)      → { t, v }[] ending at the given total
//   cashFlowWeeks(8)                    → { t, v }[] net cash in (+) / out (−) per week
//   projection({ amount: 25, cadence: "weekly", riskBps: 6000, months: 12 })
//                                       → { contributed, projected } (monthly { t, v }[])
import { displayForDemo } from "@/lib/demo/bscRef";
import type { MarketRange } from "@/hooks/useMarket";
import type { Cadence } from "@/lib/autopilot";

export interface SeriesPoint {
  /** ms timestamp */
  t: number;
  v: number;
}

/** Fixed "now" for demo timestamps: Mon 5 Oct 2026, 14:00 UTC (a trading day inside the judging week). */
export const DEMO_NOW = Date.UTC(2026, 9, 5, 14, 0, 0);

const DAY = 86_400e3;

// Points per range and the spacing between them.
const RANGE_SHAPE: Record<MarketRange, { n: number; step: number }> = {
  "1D": { n: 48, step: 15 * 60e3 },
  "1W": { n: 56, step: 3 * 3600e3 },
  "1M": { n: 30, step: DAY },
  "1Y": { n: 52, step: 7 * DAY },
  "5Y": { n: 60, step: 30 * DAY },
};
// Range change as a multiple of the asset's daily move (matches demoHistory).
const RANGE_SCALE: Record<MarketRange, number> = { "1D": 1, "1W": 2.4, "1M": 4.1, "1Y": 13, "5Y": 22 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random walk with `n` points that starts at `end / (1 + change)` and lands
 * exactly on `end`. `vol` is the per-step wobble as a fraction of the level.
 */
function walk(seed: string, n: number, end: number, changePct: number, vol: number): number[] {
  const r = rng(hash(seed));
  const start = end / (1 + changePct / 100);
  const noise: number[] = [0];
  for (let i = 1; i < n; i++) noise.push(noise[i - 1] + (r() - 0.5) * 2 * vol);
  // Remove the drift the noise picked up so the endpoints are exact.
  const last = noise[n - 1];
  return noise.map((x, i) => {
    const f = i / (n - 1);
    const detrended = x - last * f;
    return Math.max(0.01, (start + (end - start) * f) * (1 + detrended));
  });
}

function stamp(n: number, step: number): number[] {
  return Array.from({ length: n }, (_, i) => DEMO_NOW - (n - 1 - i) * step);
}

/** Price history for one symbol + range, ending at the display price. */
export function priceSeries(symbol: string, range: MarketRange): SeriesPoint[] {
  const d = displayForDemo(symbol);
  const { n, step } = RANGE_SHAPE[range];
  const change = d.kind === "safe" ? 0.01 * RANGE_SCALE[range] : d.day * RANGE_SCALE[range];
  const vol = d.kind === "safe" ? 0.0004 : d.kind === "crypto" ? 0.018 : 0.011;
  const vs = walk(`${symbol}:${range}`, n, d.price ?? 1, change, vol);
  const ts = stamp(n, step);
  return vs.map((v, i) => ({ t: ts[i], v: Number(v.toFixed(4)) }));
}

/** Portfolio value over a range, ending at `end` (the demo total by default). */
export function portfolioSeries(range: MarketRange, end = 2752.55): SeriesPoint[] {
  const { n, step } = RANGE_SHAPE[range];
  const change = 0.8 * RANGE_SCALE[range];
  const vs = walk(`portfolio:${range}`, n, end, change, 0.006);
  const ts = stamp(n, step);
  return vs.map((v, i) => ({ t: ts[i], v: Number(v.toFixed(2)) }));
}

/** Net cash flow per week for the last `n` weeks: deposits positive, withdrawals negative. */
export function cashFlowWeeks(n = 8): SeriesPoint[] {
  const r = rng(hash(`cashflow:${n}`));
  const ts = stamp(n, 7 * DAY);
  return ts.map((t, i) => {
    // Mostly deposits (a plan every week or two), an occasional cash-out.
    const roll = r();
    const v = roll < 0.18 ? -Math.round(40 + r() * 160) : roll < 0.26 ? 0 : Math.round(50 + r() * 300);
    return { t, v: i === n - 1 && v === 0 ? 150 : v };
  });
}

export interface ProjectionInput {
  /** Contribution per run, USD. */
  amount: number;
  cadence: Cadence;
  /** Risk ceiling in bps (0–10000); drives the assumed annual return. */
  riskBps: number;
  months: number;
}

const RUNS_PER_MONTH: Record<Cadence, number> = { daily: 30.4, weekly: 4.35, biweekly: 2.17, monthly: 1 };

/**
 * Contributed vs projected value, one point per month (month 0 = today).
 * Assumed annual return scales with risk: 2% at 0 bps up to 12% at 10000 bps.
 */
export function projection({ amount, cadence, riskBps, months }: ProjectionInput): {
  contributed: SeriesPoint[];
  projected: SeriesPoint[];
} {
  const perMonth = amount * RUNS_PER_MONTH[cadence];
  const annual = 0.02 + Math.min(Math.max(riskBps, 0), 10000) / 10000 * 0.1;
  const monthly = Math.pow(1 + annual, 1 / 12) - 1;
  const contributed: SeriesPoint[] = [];
  const projected: SeriesPoint[] = [];
  let paid = 0;
  let value = 0;
  const start = new Date(DEMO_NOW);
  for (let m = 0; m <= months; m++) {
    const t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, start.getUTCDate());
    if (m > 0) {
      paid += perMonth;
      value = value * (1 + monthly) + perMonth * (1 + monthly / 2);
    }
    contributed.push({ t, v: Number(paid.toFixed(2)) });
    projected.push({ t, v: Number(value.toFixed(2)) });
  }
  return { contributed, projected };
}

// ── Vera track record ────────────────────────────────────────────────────────

/**
 * Value of $100 that followed every recorded plan, weekly for the last 26 weeks,
 * ending a little ahead. Presentational: the real record has no cost basis yet.
 */
export function trackRecordSeries(end = 107.9): SeriesPoint[] {
  const n = 26;
  const vs = walk("vera:track", n, end, end - 100, 0.009);
  const ts = stamp(n, 7 * DAY);
  return vs.map((v, i) => ({ t: ts[i], v: Number(v.toFixed(2)) }));
}

function rangeCovering(ageMs: number): MarketRange {
  if (ageMs <= DAY) return "1D";
  if (ageMs <= 7 * DAY) return "1W";
  if (ageMs <= 31 * DAY) return "1M";
  if (ageMs <= 366 * DAY) return "1Y";
  return "5Y";
}

/**
 * Equal-weight blend of the plan's holdings since it was placed, normalised so
 * the first point is 100 (a sparkline "since placed"). At least two points.
 */
export function planSeriesSince(symbols: string[], placedAtMs: number): number[] {
  if (!symbols.length) return [];
  const range = rangeCovering(Math.max(0, DEMO_NOW - placedAtMs));
  const per = symbols.map((s) => priceSeries(s, range).filter((p) => p.t >= placedAtMs));
  const n = Math.min(...per.map((p) => p.length));
  if (n < 2) {
    // Younger than one step: draw flat start → the latest blended value.
    const last = symbols.reduce((sum, s) => sum + priceSeries(s, range).at(-1)!.v / priceSeries(s, range).at(-2)!.v, 0) / symbols.length;
    return [100, Number((100 * last).toFixed(2))];
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    let v = 0;
    for (const p of per) v += p[p.length - n + k].v / p[p.length - n].v;
    out.push(Number(((100 * v) / symbols.length).toFixed(3)));
  }
  return out;
}
