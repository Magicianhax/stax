// The BNB Chain demo account: a fictional person's stocks from bStock and Ondo (one of them held
// from both issuers), a little Bitcoin, dollars in USDT and a small Savings balance, with their
// BscScan-linked history. Built from the demo market (bscMarket.ts), so a holding is worth what the
// Market and Asset screens say it is, and from the visitor's own session (`fills`), so a buy made
// in the demo shows up on Home, in Owned and in the wallet. Nothing here signs, sends or calls
// Binance.
import { parseUnits } from "viem";
import { BSC, BINANCE_ROUTER } from "@/lib/chains/bsc";
import { assetBySymbol, type Asset, type RwaPlatform } from "@/lib/chains";
import type { Holding, Portfolio } from "@/hooks/useBalances";
import type { MarketSummaryResponse } from "@/hooks/useMarket";
import type { PricesResponse } from "@/hooks/usePrices";
import type { AssetPrice } from "@/lib/prices";
import type { ActivityRow, VeraRecord } from "@/lib/onchainHistory";
import type { Trade } from "@/lib/positions";
import type { WalletTx } from "@/lib/walletTx";
import { DEMO_NOW } from "@/lib/demoSeries";
import { ago, demoHistoryFor, seededTrades, type SeedLot } from "@/lib/demo/demoHistory";
import { hx } from "@/lib/demo/hex";
import { displayForDemo, demoRefPrice } from "@/lib/demo/bscRef";
import {
  buildDemoEarnings,
  buildDemoRwa,
  buildDemoSpreadBoard,
  buildDemoSpreadHistory,
  lastSessionEndMs,
  referenceAt,
} from "@/lib/demo/bscMarket";
import type { DemoFill, DemoWorld, MarketRange } from "@/lib/demo/demoTypes";

export const DEMO_BSC_ADDRESS = "0x5742a0d3b9c8417be5d8ae7c6cb0f2f3a1b2c3d4" as const;
/** Someone who sent the demo account its first dollars. Invented. */
const FUNDER = "0x2c8a7e13F4B15fDa2A6e0c9B7d51E4a30C6bD1e9";
/** Where the demo's Savings dollars went: a stand-in market address, not Venus's real one. */
const SAVINGS_MARKET = "0x4f3a1e7c9b2d8650e1a47c3f9d02b6a85e1c7d34";

/** What the demo account holds, in dollars at the real share's price. Quantity follows from that. */
interface HoldingSeed {
  symbol: string;
  /** Which issuer minted these tokens. Undefined: the asset's own default issuer (or crypto). */
  venue?: RwaPlatform;
  usd: number;
}

export const BSC_HOLDING_SEEDS: HoldingSeed[] = [
  { symbol: "NVDA", usd: 318.6 }, // bStock, the default issuer
  { symbol: "NVDA", venue: "ondo", usd: 64.1 }, // the same stock from the other issuer: a twin holding
  { symbol: "AAPL", usd: 205.6 }, // Ondo, Apple's default issuer here
  { symbol: "SPY", usd: 201.0 },
  { symbol: "GOOGL", usd: 176.4 },
  { symbol: "TSLA", usd: 142.3 },
  { symbol: "AMZN", usd: 93.0 },
  { symbol: "BTCB", usd: 58.2 },
];

const PLAN_A = { days: 0, hour: 9, minute: 12, txHash: hx("b5c0de01") };
const PLAN_B = { days: 9, hour: 16, minute: 40, txHash: hx("b5c0de02") };
const PLAN_C = { days: 21, hour: 11, minute: 5, txHash: hx("b5c0de03") };
const MANUAL_NVDA_ONDO = { days: 3, hour: 13, minute: 20, txHash: hx("b5c0de04") };
const MANUAL_BTCB_A = { days: 33, hour: 10, minute: 45, txHash: hx("b5c0de05") };
const MANUAL_BTCB_B = { days: 70, hour: 18, minute: 2, txHash: hx("b5c0de06") };

/** Lots per ticker; fractions sum to 1. The plan lots match BSC_PLANS below. */
const SEED: Record<string, SeedLot[]> = {
  NVDA: [
    { ...PLAN_A, frac: 0.06, kind: "vera" },
    { ...PLAN_C, frac: 0.14, kind: "vera" },
    { ...MANUAL_NVDA_ONDO, frac: 0.17, kind: "manual" },
    { days: 60, frac: 0.23, txHash: hx("b5c0de11"), kind: "vera" },
    { days: 140, frac: 0.22, txHash: hx("b5c0de12"), kind: "manual" },
    { days: 260, frac: 0.18, txHash: hx("b5c0de13"), kind: "manual" },
  ],
  AAPL: [
    { ...PLAN_A, frac: 0.09, kind: "vera" },
    { days: 40, frac: 0.21, txHash: hx("b5c0de14"), kind: "manual" },
    { days: 100, frac: 0.25, txHash: hx("b5c0de15"), kind: "vera" },
    { days: 190, frac: 0.25, txHash: hx("b5c0de16"), kind: "manual" },
    { days: 300, frac: 0.2, txHash: hx("b5c0de17"), kind: "manual" },
  ],
  SPY: [
    { ...PLAN_B, frac: 0.18, kind: "vera" },
    { ...PLAN_C, frac: 0.18, kind: "vera" },
    { days: 55, frac: 0.22, txHash: hx("b5c0de18"), kind: "manual" },
    { days: 130, frac: 0.22, txHash: hx("b5c0de19"), kind: "vera" },
    { days: 250, frac: 0.2, txHash: hx("b5c0de1a"), kind: "manual" },
  ],
  GOOGL: [
    { ...PLAN_A, frac: 0.1, kind: "vera" },
    { ...PLAN_C, frac: 0.2, kind: "vera" },
    { days: 85, frac: 0.25, txHash: hx("b5c0de1b"), kind: "manual" },
    { days: 170, frac: 0.25, txHash: hx("b5c0de1c"), kind: "vera" },
    { days: 320, frac: 0.2, txHash: hx("b5c0de1d"), kind: "manual" },
  ],
  TSLA: [
    { ...PLAN_B, frac: 0.17, kind: "vera" },
    { days: 60, frac: 0.33, txHash: hx("b5c0de1e"), kind: "manual" },
    { days: 150, frac: 0.3, txHash: hx("b5c0de1f"), kind: "vera" },
    { days: 280, frac: 0.2, txHash: hx("b5c0de20"), kind: "manual" },
  ],
  AMZN: [
    { ...PLAN_B, frac: 0.3, kind: "vera" },
    { days: 75, frac: 0.35, txHash: hx("b5c0de21"), kind: "manual" },
    { days: 210, frac: 0.35, txHash: hx("b5c0de22"), kind: "vera" },
  ],
  BTCB: [
    { days: 10, hour: 15, minute: 30, frac: 0.08, txHash: hx("b5c0de23"), kind: "manual" },
    { ...MANUAL_BTCB_A, frac: 0.46, kind: "manual" },
    { ...MANUAL_BTCB_B, frac: 0.46, kind: "manual" },
  ],
};

/** Vera's three recorded plans: dollars per stock, newest first. */
const BSC_PLANS: { at: { days: number; hour: number; minute: number }; txHash: `0x${string}`; block: number; riskScore: number; legs: [string, number][] }[] = [
  { at: PLAN_A, txHash: PLAN_A.txHash as `0x${string}`, block: 126_204_118, riskScore: 5400, legs: [["NVDA", 24], ["GOOGL", 18], ["AAPL", 18]] },
  { at: PLAN_B, txHash: PLAN_B.txHash as `0x${string}`, block: 125_437_902, riskScore: 4300, legs: [["SPY", 36], ["AMZN", 30], ["TSLA", 24]] },
  { at: PLAN_C, txHash: PLAN_C.txHash as `0x${string}`, block: 124_628_340, riskScore: 4700, legs: [["NVDA", 48], ["SPY", 36], ["GOOGL", 36]] },
];

/** Buys the demo person made themselves, and the Savings deposit, for the wallet's history. */
const MANUAL_BUYS: { symbol: string; venue?: RwaPlatform; usd: number; at: { days: number; hour: number; minute: number }; txHash: `0x${string}` }[] = [
  { symbol: "NVDA", venue: "ondo", usd: 64.1, at: MANUAL_NVDA_ONDO, txHash: MANUAL_NVDA_ONDO.txHash as `0x${string}` },
  { symbol: "BTCB", usd: 30, at: MANUAL_BTCB_A, txHash: MANUAL_BTCB_A.txHash as `0x${string}` },
  { symbol: "BTCB", usd: 25, at: MANUAL_BTCB_B, txHash: MANUAL_BTCB_B.txHash as `0x${string}` },
];
const SAVINGS_SEED_USD = 42.15;
const SAVINGS_TX = hx("b5c0de30") as `0x${string}`;
const SAVINGS_AT = { days: 6, hour: 12, minute: 30 };
/** The dollars the demo account keeps as spendable cash before the visitor does anything. */
const START_CASH_USD = 184.37;

const SAVINGS_RATE = { chain: "bsc", available: true, apyBps: 420, apyDisplay: "4.20%" } as const;

const cashAsset = BSC.usdc;
const atSec = (a: { days: number; hour?: number; minute?: number }) => ago(a.days, a.hour ?? 14, a.minute ?? 0);

function asset(symbol: string): Asset {
  const a = assetBySymbol(BSC, symbol);
  if (!a) throw new Error(`demo: unknown asset ${symbol}`);
  return a;
}

/** The platform whose token a (symbol, venue) pair means; undefined for crypto. */
function platformOf(a: Asset, venue?: RwaPlatform): RwaPlatform | undefined {
  return venue ?? a.platform;
}

const rowKey = (symbol: string, platform: RwaPlatform | undefined) => `${symbol}:${platform ?? ""}`;

/** Quantities held at the start of the session, before any fills, by (symbol, issuer). */
function startingQuantities(nowMs: number): Map<string, { symbol: string; platform: RwaPlatform | undefined; qty: number }> {
  const out = new Map<string, { symbol: string; platform: RwaPlatform | undefined; qty: number }>();
  for (const s of BSC_HOLDING_SEEDS) {
    const a = asset(s.symbol);
    const ref = referenceAt(s.symbol, nowMs, nowMs);
    const platform = platformOf(a, s.venue);
    out.set(rowKey(s.symbol, platform), { symbol: s.symbol, platform, qty: Number((s.usd / ref).toFixed(a.tier === "crypto" ? 6 : 4)) });
  }
  return out;
}

function applyFills(qty: Map<string, { symbol: string; platform: RwaPlatform | undefined; qty: number }>, fills: readonly DemoFill[]) {
  let cashDelta = 0;
  let savingsDelta = 0;
  for (const f of fills) {
    if (f.kind === "save") {
      cashDelta -= f.usd;
      savingsDelta += f.usd;
      continue;
    }
    const a = asset(f.symbol);
    const platform = platformOf(a, f.venue);
    const k = rowKey(f.symbol, platform);
    const row = qty.get(k) ?? { symbol: f.symbol, platform, qty: 0 };
    if (f.side === "buy") {
      row.qty += f.qty;
      cashDelta -= f.usd;
    } else {
      row.qty = Math.max(0, row.qty - f.qty);
      cashDelta += f.usd;
    }
    qty.set(k, row);
  }
  return { cashDelta, savingsDelta };
}

/** The whole BNB Chain demo, at market time `nowMs`, after the visitor's own `fills`. */
export function buildBscWorld(opts: { nowMs: number; fills?: readonly DemoFill[] }): DemoWorld {
  const { nowMs } = opts;
  const fills = opts.fills ?? [];
  const rwa = buildDemoRwa(nowMs);
  const venueView = (symbol: string, platform: RwaPlatform | undefined) =>
    platform ? rwa.tickers.find((t) => t.ticker === symbol)?.venues.find((v) => v.platform === platform) : undefined;

  // ── holdings ──
  const qty = startingQuantities(nowMs);
  const { cashDelta, savingsDelta } = applyFills(qty, fills);
  const holdings: Holding[] = [];
  for (const row of qty.values()) {
    if (row.qty <= 1e-9) continue;
    const a = asset(row.symbol);
    const d = displayForDemo(row.symbol, a.name);
    const priceUsd = a.tier === "crypto" ? (demoRefPrice(row.symbol) ?? 1) : (venueView(row.symbol, row.platform)?.tokenPrice ?? demoRefPrice(row.symbol) ?? 1);
    holdings.push({
      asset: a,
      raw: parseUnits(row.qty.toFixed(6), 18),
      qty: row.qty,
      valueUsd: Number((row.qty * priceUsd).toFixed(2)),
      priceUsd,
      dayChangePct: d.day,
      spark: d.spark,
      ...(a.tier === "crypto" ? {} : { venue: row.platform }),
    });
  }
  holdings.sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0));
  const invested = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);

  const cash = Math.max(0, Number((START_CASH_USD + cashDelta).toFixed(2)));
  const usdc = { raw: parseUnits(cash.toFixed(2), cashAsset.decimals), value: cash };
  const portfolio: Portfolio = { holdings, investedUsd: invested, cashUsd: cash, totalUsd: invested + cash };

  // ── what the visitor did this session, newest first ──
  // Shown a few minutes after the seeded "now" so they read as Today and sort above everything seeded.
  const sessionAt = (i: number) => Math.floor(DEMO_NOW / 1000) - 120 + i * 20;

  // ── Vera's plans → Activity ──
  const legsOf = (legs: [string, number][]) =>
    legs.map(([symbol, usdcIn]) => ({ symbol, usdcIn, qty: Number((usdcIn / (demoRefPrice(symbol) ?? 1)).toFixed(4)) }));
  const seededPlans: ActivityRow[] = BSC_PLANS.map((p) => ({
    kind: "invest",
    usdc: p.legs.reduce((s, [, u]) => s + u, 0),
    legCount: p.legs.length,
    txHash: p.txHash,
    blockNumber: BigInt(p.block),
    timestamp: atSec(p.at),
    symbols: p.legs.map(([s]) => s),
    legs: legsOf(p.legs),
  }));
  // A basket the visitor placed in the demo is recorded as one plan with its legs, like Vera's.
  const sessionPlans: ActivityRow[] = [];
  const planTxs = new Map<string, DemoFill[]>();
  for (const f of fills) {
    if (f.kind !== "trade" || f.side !== "buy") continue;
    planTxs.set(f.txHash, [...(planTxs.get(f.txHash) ?? []), f]);
  }
  let planIdx = 0;
  for (const [tx, legs] of planTxs) {
    if (legs.length < 2) continue; // a single buy is a manual trade, not a plan
    sessionPlans.push({
      kind: "invest",
      usdc: legs.reduce((s, l) => s + (l.kind === "trade" ? l.usd : 0), 0),
      legCount: legs.length,
      txHash: tx as `0x${string}`,
      blockNumber: BigInt(126_300_000 + planIdx),
      timestamp: sessionAt(planIdx++),
      symbols: legs.map((l) => (l.kind === "trade" ? l.symbol : "")),
      legs: legs.map((l) => (l.kind === "trade" ? { symbol: l.symbol, usdcIn: l.usd, qty: Number(l.qty.toFixed(4)) } : { symbol: "", usdcIn: 0, qty: 0 })),
    });
  }
  const activity = [...sessionPlans.reverse(), ...seededPlans];

  const veraRecord: VeraRecord = {
    totalRecommendations: 7 + sessionPlans.length,
    totalExecutedUsd: seededPlans.reduce((s, a) => s + a.usdc, 0) + sessionPlans.reduce((s, a) => s + a.usdc, 0),
    executedCount: seededPlans.length + sessionPlans.length,
    recentRecommendations: activity.slice(0, 3).map((a, i) => ({
      planId: hx(`a7e${i}c0de`) as `0x${string}`,
      riskScore: BSC_PLANS[i]?.riskScore ?? 5000,
      usdcSpent: a.usdc,
      txHash: a.txHash,
      blockNumber: a.blockNumber,
      timestamp: a.timestamp,
      symbols: a.symbols,
    })),
  };

  // ── Wallet → every transfer in or out, by the dollars that moved ──
  const tx = (
    hash: `0x${string}`,
    direction: "in" | "out",
    symbol: string,
    amount: number,
    counterparty: string,
    tokenAddress: string,
    timestamp: number,
  ): WalletTx => ({ hash, direction, symbol, amount, counterparty, tokenAddress, blockNumber: 0, timestamp });
  const usdtTx = (hash: `0x${string}`, direction: "in" | "out", amount: number, counterparty: string, timestamp: number) =>
    tx(hash, direction, cashAsset.symbol, amount, counterparty, cashAsset.address, timestamp);
  const tokenAddr = (symbol: string, venue?: RwaPlatform): string => {
    const a = asset(symbol);
    return venue && a.twin && a.twin.platform === venue ? a.twin.address : (a.address ?? "");
  };

  const rows: WalletTx[] = [];
  let outs = 0;
  for (const p of BSC_PLANS) {
    const ts = atSec(p.at);
    for (const [symbol, usd] of p.legs) {
      rows.push(usdtTx(p.txHash, "out", usd, BINANCE_ROUTER, ts));
      rows.push(tx(p.txHash, "in", symbol, Number((usd / (demoRefPrice(symbol) ?? 1)).toFixed(4)), BINANCE_ROUTER, tokenAddr(symbol), ts));
      outs += usd;
    }
  }
  for (const m of MANUAL_BUYS) {
    const ts = atSec(m.at);
    rows.push(usdtTx(m.txHash, "out", m.usd, BINANCE_ROUTER, ts));
    rows.push(tx(m.txHash, "in", m.symbol, Number((m.usd / (demoRefPrice(m.symbol) ?? 1)).toFixed(m.symbol === "BTCB" ? 6 : 4)), BINANCE_ROUTER, tokenAddr(m.symbol, m.venue), ts));
    outs += m.usd;
  }
  rows.push(usdtTx(SAVINGS_TX, "out", SAVINGS_SEED_USD, SAVINGS_MARKET, atSec(SAVINGS_AT)));
  outs += SAVINGS_SEED_USD;
  // Deposits are whatever makes the ledger land exactly on today's cash.
  const deposited = Number((outs + START_CASH_USD).toFixed(2));
  rows.push(usdtTx(hx("b5c0de40") as `0x${string}`, "in", 300, FUNDER, ago(82, 19, 3)));
  rows.push(usdtTx(hx("b5c0de41") as `0x${string}`, "in", 200, FUNDER, ago(36, 8, 15)));
  rows.push(usdtTx(hx("b5c0de42") as `0x${string}`, "in", Number((deposited - 500).toFixed(2)), FUNDER, ago(11, 17, 40)));

  fills.forEach((f, i) => {
    const ts = sessionAt(i);
    if (f.kind === "save") {
      rows.push(usdtTx(f.txHash, f.usd >= 0 ? "out" : "in", Math.abs(f.usd), SAVINGS_MARKET, ts));
      return;
    }
    rows.push(usdtTx(f.txHash, f.side === "buy" ? "out" : "in", f.usd, BINANCE_ROUTER, ts));
    rows.push(tx(f.txHash, f.side === "buy" ? "in" : "out", f.symbol, Number(f.qty.toFixed(f.symbol === "BTCB" ? 6 : 4)), BINANCE_ROUTER, tokenAddr(f.symbol, f.venue), ts));
  });
  const transactions = rows.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  // ── prices and moves, from the same catalog ──
  const closedAt = Math.floor(lastSessionEndMs(nowMs) / 1000);
  const prices: PricesResponse = {
    chain: "bsc",
    asOf: new Date(nowMs).toISOString(),
    prices: Object.fromEntries(
      BSC.assets.all.map((a) => {
        const d = displayForDemo(a.symbol, a.name);
        const t = rwa.tickers.find((x) => x.ticker === a.symbol);
        const best = t?.venues.find((v) => v.platform === (t.bestVenue ?? a.platform)) ?? t?.venues[0];
        const price: AssetPrice =
          a.tier === "crypto"
            ? { symbol: a.symbol, priceUsd: d.price ?? 1, source: "none" }
            : { symbol: a.symbol, priceUsd: best?.tokenPrice ?? d.price, marketPrice: best?.referencePrice ?? d.price, marketPriceAt: closedAt, source: "none" };
        return [a.symbol, price];
      }),
    ),
  };
  const marketSummary: MarketSummaryResponse = {
    asOf: new Date(nowMs).toISOString(),
    summary: Object.fromEntries(
      BSC.assets.all.map((a) => {
        const d = displayForDemo(a.symbol, a.name);
        return [a.symbol, { dayChangePct: d.day, spark: d.spark }];
      }),
    ),
  };

  // ── cost basis and the value line ──
  const sessionTrades: Trade[] = fills.flatMap((f, i): Trade[] =>
    f.kind === "trade"
      ? [{ symbol: f.symbol, txHash: f.txHash, at: sessionAt(i), qty: f.qty, usdc: f.usd, kind: "manual" as const, side: f.side }]
      : [],
  );
  // The seeded ledger is built from the opening holdings, so a session's fills never change what
  // earlier lots cost. Rebuilt per call but cheap: a handful of lots and seven price series.
  const opening = startingQuantities(nowMs);
  const openingHoldings = [...opening.values()].map((r) => ({ asset: asset(r.symbol), qty: r.qty, priceUsd: demoRefPrice(r.symbol) }));
  const trades = [...seededTrades(openingHoldings, SEED), ...sessionTrades];
  const history = (range: MarketRange) => demoHistoryFor(trades, holdings, cash, range);

  const savings = { balanceUsd: Number((SAVINGS_SEED_USD + savingsDelta).toFixed(2)), rate: { ...SAVINGS_RATE } };

  return {
    chain: "bsc",
    address: DEMO_BSC_ADDRESS,
    usdc,
    portfolio,
    activity,
    transactions,
    veraRecord,
    prices,
    marketSummary,
    history,
    rwa,
    spreadBoard: buildDemoSpreadBoard(rwa),
    spreadHistory: (ticker) => buildDemoSpreadHistory(ticker, nowMs),
    earnings: buildDemoEarnings(nowMs),
    savings,
    nowMs,
  };
}
