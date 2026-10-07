// Cost basis + value history — the pure maths, shared by the server loader
// (lib/server/positions.ts: Vera fills + wallet transfers) and the demo
// (lib/demo/demoHistory.ts: seeded lots). Nothing here touches chain or DB.
//
//   buildPositions(trades, priceOf)          → PositionHistory[] (average cost, realized on sells)
//   valueSeries(times, trades, priceAt, cash) → { t, v }[] account value at each time
//
// Method: average cost. A buy adds qty + cost; a sell removes qty at the running
// average and books proceeds − avgCost × qtySold as realized. Trades are
// processed chronologically. Cash in the value series is reconstructed from
// today's balance by reversing trades (a buy after t means more cash at t), so
// the line is continuous through trades; deposits are NOT modelled (the cash
// they added is treated as always there), which keeps first→last equal to the
// gain on positions. Times: `at` is unix seconds; series `t` is ms.

import type { StaxChain } from "./chains/types";

export type LotKind = "vera" | "manual";
export type LotSide = "buy" | "sell";

export interface Lot {
  txHash: string;
  /** Unix seconds. */
  at: number;
  /** Units of the asset bought (or sold). Always positive. */
  qty: number;
  /** USD paid (buy, fee included) or received (sell). */
  usdc: number;
  kind: LotKind;
  side: LotSide;
}

/** A lot with the symbol it belongs to — the ledger's row type. */
export interface Trade extends Lot {
  symbol: string;
}

export interface PositionHistory {
  symbol: string;
  /** Units still held according to the lots. */
  qty: number;
  /** Total cost of the units still held (average-cost method). */
  costBasisUsd: number;
  avgCostPerUnit: number;
  /** qty × price − costBasisUsd, or null when unpriced. */
  unrealizedUsd: number | null;
  unrealizedPct: number | null;
  /** Booked on sells: proceeds − avgCost × qtySold. */
  realizedUsd: number;
  /** Unix seconds of the first buy, or null. */
  firstBoughtAt: number | null;
  /** Every buy and sell, oldest first. */
  lots: Lot[];
}

export interface SeriesPoint {
  /** ms */
  t: number;
  v: number;
}

const EPS = 1e-12;

/** Chronological order; buys before sells at the same second so a same-block round trip nets right. */
export function sortTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => a.at - b.at || (a.side === b.side ? 0 : a.side === "buy" ? -1 : 1));
}

/** Average-cost positions from a ledger of trades. Symbols with no remaining qty and no realized P&L are dropped. */
export function buildPositions(trades: Trade[], priceOf: (symbol: string) => number | undefined): PositionHistory[] {
  const state = new Map<string, { qty: number; cost: number; realized: number; first: number | null; lots: Lot[] }>();
  for (const t of sortTrades(trades)) {
    let s = state.get(t.symbol);
    if (!s) {
      s = { qty: 0, cost: 0, realized: 0, first: null, lots: [] };
      state.set(t.symbol, s);
    }
    const { symbol: _symbol, ...lot } = t;
    void _symbol;
    s.lots.push(lot);
    if (t.side === "buy") {
      s.qty += t.qty;
      s.cost += t.usdc;
      if (s.first === null) s.first = t.at;
    } else {
      // Selling more than the lots know about (interest on aUSDC, a transfer in)
      // realizes only what we can cost; the rest is pure proceeds.
      const sold = Math.min(t.qty, s.qty);
      const avg = s.qty > EPS ? s.cost / s.qty : 0;
      s.realized += t.usdc - avg * sold;
      s.qty -= sold;
      s.cost -= avg * sold;
      if (s.qty <= EPS) {
        s.qty = 0;
        s.cost = 0;
      }
    }
  }
  const out: PositionHistory[] = [];
  for (const [symbol, s] of state) {
    if (s.qty <= EPS && Math.abs(s.realized) < 0.005) continue;
    const price = priceOf(symbol);
    const value = price !== undefined ? s.qty * price : null;
    const unrealized = value !== null ? value - s.cost : null;
    out.push({
      symbol,
      qty: s.qty,
      costBasisUsd: round2(s.cost),
      avgCostPerUnit: s.qty > EPS ? s.cost / s.qty : 0,
      unrealizedUsd: unrealized !== null ? round2(unrealized) : null,
      unrealizedPct: unrealized !== null && s.cost > EPS ? (unrealized / s.cost) * 100 : null,
      realizedUsd: round2(s.realized),
      firstBoughtAt: s.first,
      lots: s.lots,
    });
  }
  // Biggest position first, closed positions (realized only) last.
  out.sort((a, b) => b.costBasisUsd - a.costBasisUsd);
  return out;
}

/** Units of `symbol` held at unix-seconds `at` (buys minus sells up to and including that time). */
export function qtyAt(trades: Trade[], symbol: string, at: number): number {
  let q = 0;
  for (const t of trades) {
    if (t.symbol !== symbol || t.at > at) continue;
    q += t.side === "buy" ? t.qty : -t.qty;
  }
  return Math.max(0, q);
}

/** Cash at unix-seconds `at`, reversing trades after it from today's balance. */
export function cashAt(trades: Trade[], cashNow: number, at: number): number {
  let c = cashNow;
  for (const t of trades) {
    if (t.at <= at) continue;
    c += t.side === "buy" ? t.usdc : -t.usdc;
  }
  return Math.max(0, c);
}

/**
 * Account value at each of `times` (ms): reconstructed cash + Σ qty × price.
 * `priceAt` returns the price of a symbol at a time, or undefined when unknown
 * (that holding contributes nothing at that point).
 */
export function valueSeries(
  times: number[],
  trades: Trade[],
  priceAt: (symbol: string, tMs: number) => number | undefined,
  cashNow: number,
): SeriesPoint[] {
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  return times.map((t) => {
    const sec = t / 1000;
    let v = cashAt(trades, cashNow, sec);
    for (const s of symbols) {
      const q = qtyAt(trades, s, sec);
      if (q <= EPS) continue;
      const p = priceAt(s, t);
      if (p !== undefined) v += q * p;
    }
    return { t, v: round2(v) };
  });
}

/** Even resample by index, keeping first + last. */
export function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n || n <= 1) return arr;
  return Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
}

/** Linear interpolation on a sorted { t, v } series; clamps outside the range. */
export function interpolate(points: SeriesPoint[], t: number): number | undefined {
  if (!points.length) return undefined;
  if (t <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (t >= last.t) return last.v;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * f;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface HistoryTotals {
  costBasisUsd: number;
  unrealizedUsd: number;
  realizedUsd: number;
}

export function totalsOf(positions: PositionHistory[]): HistoryTotals {
  let cost = 0;
  let unrealized = 0;
  let realized = 0;
  for (const p of positions) {
    cost += p.costBasisUsd;
    unrealized += p.unrealizedUsd ?? 0;
    realized += p.realizedUsd;
  }
  return { costBasisUsd: round2(cost), unrealizedUsd: round2(unrealized), realizedUsd: round2(realized) };
}

/**
 * Every token an executor leg can deliver on `chain`, by lowercased address: each asset's own
 * token and, on BNB Chain, its twin issuer's (a Vera plan or an Autopilot rule can buy either
 * bStock or Ondo), each with that token's own decimals. Off BSC this is exactly one entry per
 * asset address, as before.
 */
export function legTokenIndex(chain: Pick<StaxChain, "assets">): Map<string, { symbol: string; decimals: number }> {
  const index = new Map<string, { symbol: string; decimals: number }>(
    chain.assets.all.filter((a) => !!a.address).map((a) => [a.address!.toLowerCase(), { symbol: a.symbol, decimals: a.decimals ?? 18 }]),
  );
  for (const a of chain.assets.all) {
    const twin = a.twin?.address.toLowerCase();
    if (twin && !index.has(twin)) index.set(twin, { symbol: a.symbol, decimals: a.twin!.decimals });
  }
  return index;
}
