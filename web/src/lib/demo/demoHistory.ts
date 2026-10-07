// Demo cost basis + value history — seeded lots for the demo holdings so Owned
// and Asset detail show real-looking gains without auth or a database. Same
// maths as production (lib/positions); only the inputs are invented. Demo only.
//
// Lots per holding: the three placed plans in DEMO_ACTIVITY (today, 24 d and
// 48 d ago) plus a few older buys across the past year, each costed at the
// seeded 1Y price for that week — so the position's gain is the asset's
// seeded price appreciation.
import type { MarketRange } from "@/hooks/useMarket";
import { DEMO_NOW, priceSeries } from "@/lib/demoSeries";
import { hx } from "@/lib/demo/hex";
import { DEMO_PORTFOLIO, DEMO_USDC } from "@/lib/demo/demoData";
import {
  buildPositions,
  interpolate,
  totalsOf,
  valueSeries,
  type HistoryTotals,
  type PositionHistory,
  type SeriesPoint,
  type Trade,
} from "@/lib/positions";

const DAY = 86_400;
export { hx };

/** Unix seconds `days` before the demo "now", at `hour:minute` UTC (mirrors demoData's `ago`). */
export function ago(days: number, hour = 14, minute = 0): number {
  return Math.floor(DEMO_NOW / 1000) - days * DAY + (hour - 14) * 3600 + minute * 60;
}

export interface SeedLot {
  days: number;
  /** Share of today's quantity bought in this lot. Shares per symbol sum to 1. */
  frac: number;
  txHash: string;
  kind: "vera" | "manual";
  hour?: number;
  minute?: number;
}

// The plan txs match DEMO_ACTIVITY so Activity, Vera's record and "Your buys" agree.
const PLAN_A = { days: 0, hour: 9, minute: 12, txHash: hx("7b41a9c0") };
const PLAN_B = { days: 24, hour: 16, minute: 40, txHash: hx("910e7f22") };
const PLAN_C = { days: 48, hour: 11, minute: 5, txHash: hx("a27c1043") };

const SEED: Record<string, SeedLot[]> = {
  NVDA: [
    { ...PLAN_A, frac: 0.18, kind: "vera" },
    { ...PLAN_C, frac: 0.28, kind: "vera" },
    { days: 150, frac: 0.24, txHash: hx("3c9d11ab"), kind: "manual" },
    { days: 290, frac: 0.3, txHash: hx("5e2f70c1"), kind: "manual" },
  ],
  AAPL: [
    { ...PLAN_A, frac: 0.12, kind: "vera" },
    { ...PLAN_B, frac: 0.1, kind: "vera" },
    { ...PLAN_C, frac: 0.2, kind: "vera" },
    { days: 130, frac: 0.28, txHash: hx("8a4b6d02"), kind: "vera" },
    { days: 330, frac: 0.3, txHash: hx("c17e93f4"), kind: "manual" },
  ],
  GOOGL: [
    { ...PLAN_A, frac: 0.09, kind: "vera" },
    { ...PLAN_B, frac: 0.06, kind: "vera" },
    { ...PLAN_C, frac: 0.14, kind: "vera" },
    { days: 95, frac: 0.21, txHash: hx("d4f1a8e3"), kind: "manual" },
    { days: 200, frac: 0.22, txHash: hx("2b7c05d9"), kind: "vera" },
    { days: 340, frac: 0.28, txHash: hx("f09e3a67"), kind: "manual" },
  ],
  aUSDC: [
    { ...PLAN_A, frac: 0.13, kind: "vera" },
    { ...PLAN_B, frac: 0.08, kind: "vera" },
    { ...PLAN_C, frac: 0.21, kind: "vera" },
    { days: 180, frac: 0.58, txHash: hx("6d8b2e15"), kind: "manual" },
  ],
};

/** Coverage well before the oldest lot, so every range reads as fully covered. */
export const DEMO_COVERAGE_FROM = ago(400);

export interface DemoHistory {
  positions: PositionHistory[];
  series: SeriesPoint[];
  coverageFrom: number;
  totals: HistoryTotals;
  cashUsd: number;
}

type HoldingLike = { asset: { symbol: string }; qty: number; priceUsd?: number };

/**
 * The seeded ledger for `holdings`: one buy per seed lot, costed at that week's 1Y price.
 * Several holding rows of one ticker (a twin: the same stock from both issuers) share that
 * ticker's lots, split by their combined quantity.
 */
export function seededTrades(holdings: readonly HoldingLike[], seeds: Record<string, SeedLot[]>): Trade[] {
  const qtyBySymbol = new Map<string, number>();
  const priceBySymbol = new Map<string, number | undefined>();
  for (const h of holdings) {
    qtyBySymbol.set(h.asset.symbol, (qtyBySymbol.get(h.asset.symbol) ?? 0) + h.qty);
    if (!priceBySymbol.has(h.asset.symbol)) priceBySymbol.set(h.asset.symbol, h.priceUsd);
  }
  const out: Trade[] = [];
  for (const [symbol, qty] of qtyBySymbol) {
    const lots = seeds[symbol];
    if (!lots) continue;
    const year = priceSeries(symbol, "1Y");
    for (const s of lots) {
      const at = ago(s.days, s.hour ?? 14, s.minute ?? 0);
      const lotQty = qty * s.frac;
      const price = interpolate(year, at * 1000) ?? priceBySymbol.get(symbol) ?? 1;
      out.push({
        symbol,
        txHash: s.txHash,
        at,
        qty: lotQty,
        usdc: Math.round(lotQty * price * 100) / 100,
        kind: s.kind,
        side: "buy",
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Positions + the account value line for `range`, deterministic, for a demo account of
 * `holdings` and `cashUsd` whose past is `trades` (the seeded ledger, plus whatever the visitor
 * did in this session).
 */
export function demoHistoryFor(trades: Trade[], holdings: readonly HoldingLike[], cashUsd: number, range: MarketRange): DemoHistory {
  const priceNow = new Map<string, number | undefined>();
  for (const h of holdings) if (!priceNow.has(h.asset.symbol)) priceNow.set(h.asset.symbol, h.priceUsd);
  const positions = buildPositions(trades, (s) => priceNow.get(s));
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  const perSymbol = new Map(symbols.map((s) => [s, priceSeries(s, range)]));
  const times = perSymbol.get(symbols[0])?.map((p) => p.t) ?? [];
  const series = valueSeries(times, trades, (s, t) => interpolate(perSymbol.get(s) ?? [], t), cashUsd);
  return { positions, series, coverageFrom: DEMO_COVERAGE_FROM, totals: totalsOf(positions), cashUsd };
}

let tradesCache: Trade[] | null = null;

/** The Base demo's seeded ledger. */
export function demoTrades(): Trade[] {
  if (!tradesCache) tradesCache = seededTrades(DEMO_PORTFOLIO.holdings, SEED);
  return tradesCache;
}

/** Positions + the account value line for `range`, deterministic (the Base demo). */
export function demoPortfolioHistory(range: MarketRange): DemoHistory {
  return demoHistoryFor(demoTrades(), DEMO_PORTFOLIO.holdings, DEMO_USDC.value, range);
}
