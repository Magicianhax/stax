// Demo data for the marketing-site app preview. Feeds the REAL Stax screens
// believable values without auth, chain reads, or AI calls. Only ever used under
// <DemoProvider> (the /demo route + landing phones); the production app never
// imports the provider, so this has zero effect on real behaviour.
//
// The demo shows the Base universe (Coinbase tokenized stocks + Aave safe dollars).
import { parseUnits } from "viem";
import { getChain, type Asset } from "@/lib/chains";
import { displayFor } from "@/lib/displayAssets";
import type { Holding } from "@/hooks/useBalances";
import type { ActivityRow, VeraRecord } from "@/lib/onchainHistory";
import type { AllocateResult, InvestSuccess } from "@/lib/invest-types";
import type { Allocation } from "@/lib/allocation-schema";
import type { Basket } from "@/lib/baskets";
import type { MarketHistoryResponse, MarketRange, MarketSummaryResponse } from "@/hooks/useMarket";
import type { PricesResponse } from "@/hooks/usePrices";
import type { AssetPrice } from "@/lib/prices";
import type { WalletTx } from "@/lib/walletTx";
import { DEMO_NOW } from "@/lib/demoSeries";

const DEMO_CHAIN = getChain("base");
const DAY = 86_400;
/** Unix seconds, `days` before the fixed demo "now" (see demoSeries.DEMO_NOW), at `hour` UTC. */
function ago(days: number, hour = 14, minute = 0): number {
  return Math.floor(DEMO_NOW / 1000) - days * DAY + (hour - 14) * 3600 + minute * 60;
}

export const DEMO_ADDRESS = "0x5742a0d3b9c8417be5d8ae7c6cb0f2f3a1b2c3d4" as const;

function assetOf(symbol: string): Asset {
  const a = DEMO_CHAIN.assets.all.find((x) => x.symbol === symbol);
  if (!a) throw new Error(`demo: unknown asset ${symbol}`);
  return a;
}

function holding(symbol: string, valueUsd: number): Holding {
  const asset = assetOf(symbol);
  const dec = asset.decimals ?? 18;
  const d = displayFor(symbol, asset.name);
  const priceUsd = d.price ?? 1;
  const qty = valueUsd / priceUsd;
  const raw = parseUnits(qty.toFixed(Math.min(dec, 6)), dec);
  return { asset, raw, qty, valueUsd, priceUsd, dayChangePct: d.day, spark: d.spark };
}

// ~$2,512 invested across four holdings + ~$240 spendable cash.
const DEMO_HOLDINGS: Holding[] = [
  holding("GOOGL", 880.05),
  holding("AAPL", 642.18),
  holding("NVDA", 511.4),
  holding("aUSDC", 478.37),
];

const DEMO_INVESTED = DEMO_HOLDINGS.reduce((s, h) => s + (h.valueUsd ?? 0), 0);

export const DEMO_USDC = { raw: parseUnits("240.55", 6), value: 240.55 };

// Every demo screen prices assets from the same reference table (displayAssets),
// so a holding is worth the same on Home, Owned, Market and Asset detail.
export const DEMO_PRICES: PricesResponse = {
  chain: DEMO_CHAIN.key,
  asOf: new Date(DEMO_NOW).toISOString(),
  prices: Object.fromEntries(
    DEMO_CHAIN.assets.all.map((a) => {
      const d = displayFor(a.symbol, a.name);
      const price: AssetPrice = {
        symbol: a.symbol,
        priceUsd: d.price ?? 1,
        marketPrice: d.price ?? 1,
        marketPriceAt: Math.floor(DEMO_NOW / 1000) - 2 * 24 * 3600,
        apy: typeof d.apy === "number" ? d.apy : d.apy ? parseFloat(String(d.apy)) || undefined : undefined,
        source: "none",
      };
      return [a.symbol, price];
    }),
  ),
};

export const DEMO_MARKET_SUMMARY: MarketSummaryResponse = {
  asOf: new Date(DEMO_NOW).toISOString(),
  summary: Object.fromEntries(
    DEMO_CHAIN.assets.all.map((a) => {
      const d = displayFor(a.symbol, a.name);
      return [a.symbol, { dayChangePct: d.day ?? 0, spark: d.spark ?? [] }];
    }),
  ),
};

export const DEMO_PORTFOLIO = {
  holdings: DEMO_HOLDINGS,
  investedUsd: DEMO_INVESTED,
  cashUsd: DEMO_USDC.value,
  totalUsd: DEMO_INVESTED + DEMO_USDC.value,
};

const hx = (tag: string): `0x${string}` => ("0x" + tag.repeat(32).slice(0, 64)) as `0x${string}`;

// Three placed plans, newest first. Timestamps count back from the fixed demo
// "now" (Mon 7 Sep 2026 14:00 UTC) so Activity groups and Wallet dates are stable.
const PLAN_A = ["NVDA", "AAPL", "GOOGL", "aUSDC"];
const PLAN_B = ["AAPL", "GOOGL", "aUSDC"];
export const DEMO_ACTIVITY: ActivityRow[] = [
  { kind: "invest", usdc: 300, legCount: 4, txHash: hx("7b41a9c0"), blockNumber: BigInt(0), timestamp: ago(0, 9, 12), symbols: PLAN_A },
  { kind: "invest", usdc: 150, legCount: 3, txHash: hx("910e7f22"), blockNumber: BigInt(0), timestamp: ago(24, 16, 40), symbols: PLAN_B },
  { kind: "invest", usdc: 500, legCount: 4, txHash: hx("a27c1043"), blockNumber: BigInt(0), timestamp: ago(48, 11, 5), symbols: PLAN_A },
];

// Wallet transfers that mirror the activity above: every plan is USDC leaving
// for the executor, and the deposits before it are what funded it. In − out
// lands exactly on DEMO_USDC (240.55) so Wallet and Home agree.
const EXECUTOR = DEMO_CHAIN.contracts.executor;
const FUNDER = "0x2c8a7e13F4B15fDa2A6e0c9B7d51E4a30C6bD1e9";
export const DEMO_TRANSACTIONS: WalletTx[] = [
  { hash: hx("7b41a9c0"), direction: "out", symbol: "USDC", amount: 300, counterparty: EXECUTOR, tokenAddress: DEMO_CHAIN.usdc.address, blockNumber: 0, timestamp: ago(0, 9, 12) },
  { hash: hx("c4d5e6f7"), direction: "in", symbol: "USDC", amount: 300, counterparty: FUNDER, tokenAddress: DEMO_CHAIN.usdc.address, blockNumber: 0, timestamp: ago(8, 18, 3) },
  { hash: hx("910e7f22"), direction: "out", symbol: "USDC", amount: 150, counterparty: EXECUTOR, tokenAddress: DEMO_CHAIN.usdc.address, blockNumber: 0, timestamp: ago(24, 16, 40) },
  { hash: hx("d5e6f7a8"), direction: "in", symbol: "USDC", amount: 350, counterparty: FUNDER, tokenAddress: DEMO_CHAIN.usdc.address, blockNumber: 0, timestamp: ago(28, 12, 30) },
  { hash: hx("e6f7a8b9"), direction: "in", symbol: "USDC", amount: 40.55, counterparty: FUNDER, tokenAddress: DEMO_CHAIN.usdc.address, blockNumber: 0, timestamp: ago(41, 8, 15) },
  { hash: hx("a27c1043"), direction: "out", symbol: "USDC", amount: 500, counterparty: EXECUTOR, tokenAddress: DEMO_CHAIN.usdc.address, blockNumber: 0, timestamp: ago(48, 11, 5) },
  { hash: hx("f7a8b9c0"), direction: "in", symbol: "USDC", amount: 500, counterparty: FUNDER, tokenAddress: DEMO_CHAIN.usdc.address, blockNumber: 0, timestamp: ago(50, 19, 48) },
];

// Vera's track record (the Vera screen's stat band + recorded recommendations).
export const DEMO_VERA_RECORD: VeraRecord = {
  totalRecommendations: 24,
  totalExecutedUsd: 18450,
  executedCount: 19,
  recentRecommendations: [
    { planId: hx("a1b2c3d4"), riskScore: 4200, usdcSpent: 300, txHash: hx("7b41a9c0"), blockNumber: BigInt(0), timestamp: ago(0, 9, 12), symbols: PLAN_A },
    { planId: hx("b2c3d4e5"), riskScore: 6100, usdcSpent: 150, txHash: hx("910e7f22"), blockNumber: BigInt(0), timestamp: ago(24, 16, 40), symbols: PLAN_B },
    { planId: hx("c3d4e5f6"), riskScore: 2600, usdcSpent: 500, txHash: hx("a27c1043"), blockNumber: BigInt(0), timestamp: ago(48, 11, 5), symbols: PLAN_A },
  ],
};

// A canned, risk-aware allocation (no AI call). Weights always sum to 100.
export function demoAllocate(goal: string, amountUsd: number, risk?: string): AllocateResult {
  const base =
    risk === "conservative"
      ? [
          { symbol: "GOOGL", weightPct: 35, reason: "A steady giant with search, YouTube, and cloud." },
          { symbol: "AAPL", weightPct: 20, reason: "A profitable giant that holds up well." },
          { symbol: "NVDA", weightPct: 15, reason: "A measured slice of the AI leader." },
          { symbol: "aUSDC", weightPct: 30, reason: "A calm dollar cushion that still earns." },
        ]
      : risk === "aggressive"
        ? [
            { symbol: "NVDA", weightPct: 40, reason: "Leads the AI boom, with bigger swings." },
            { symbol: "AAPL", weightPct: 25, reason: "A profitable anchor for the basket." },
            { symbol: "GOOGL", weightPct: 25, reason: "Search, YouTube, and cloud in one name." },
            { symbol: "aUSDC", weightPct: 10, reason: "A small safety cushion." },
          ]
        : [
            { symbol: "NVDA", weightPct: 30, reason: "Leads the AI boom." },
            { symbol: "AAPL", weightPct: 25, reason: "A steady, profitable giant." },
            { symbol: "GOOGL", weightPct: 25, reason: "Search, YouTube, and cloud in one name." },
            { symbol: "aUSDC", weightPct: 20, reason: "A calm dollar cushion that still earns." },
          ];
  const riskScore = risk === "conservative" ? 2600 : risk === "aggressive" ? 6200 : 4200;
  return {
    summary: "A balanced mix that grows over time and keeps some safe.",
    rationale:
      "Most of the money goes into names you know, with a slice kept in steady dollars so a rough week doesn't sting as much. You can nudge it safer or bolder anytime.",
    riskScore,
    allocations: base,
    amountUsd,
    model: "demo",
    chain: DEMO_CHAIN.key,
  };
}

export function demoSuccess(alloc: Allocation, amountUsd: number): InvestSuccess {
  return {
    txHash: hx("e1f0a1b2"),
    amountUsd,
    holdings: alloc.allocations.map((a) => ({
      symbol: a.symbol,
      name: a.symbol,
      weightPct: a.weightPct,
      amountUsd: (amountUsd * a.weightPct) / 100,
    })),
  };
}

// ── Baskets (demo) ────────────────────────────────────────────────────────────
// One personal basket so the "Yours" section has something to show, plus a
// deterministic history series per symbol (scaled from the display spark) so the
// performance chips + sparklines work offline. Demo numbers, demo screens only.

export function demoSeedBaskets(chain: "base" | "mantle"): Basket[] {
  if (chain !== "base") return [];
  const items = [
    { symbol: "NVDA", weightPct: 30, reason: "Leads the AI boom." },
    { symbol: "AAPL", weightPct: 25, reason: "A steady, profitable giant." },
    { symbol: "GOOGL", weightPct: 25, reason: "Search, YouTube, and cloud in one name." },
    { symbol: "aUSDC", weightPct: 20, reason: "A calm dollar cushion that still earns." },
  ];
  return [
    {
      id: "p_demo_first",
      chain: "base",
      name: "My first Stax",
      tagline: "A balanced mix that grows over time and keeps some safe.",
      icon: "basket",
      color: "#57a07e",
      items,
      riskScore: 5000, // rehydrated on read by useBaskets
      author: "you",
      createdAt: Math.floor(Date.now() / 1000) - 12 * 86_400,
      source: { goal: "Grow $300, mostly big names, keep some safe" },
    },
  ];
}

const DEMO_RANGE_SCALE: Record<MarketRange, number> = { "1D": 1, "1W": 2.4, "1M": 4.1, "1Y": 13, All: 22 };

/** Demo price history for one symbol + range, shaped from its display sparkline. */
export function demoHistory(symbol: string, range: MarketRange): MarketHistoryResponse {
  const d = displayFor(symbol);
  const changePct = Number((d.day * DEMO_RANGE_SCALE[range]).toFixed(2));
  const base = d.price ?? 1;
  const first = d.spark[0] || 1;
  const last = d.spark[d.spark.length - 1] || 1;
  // Rescale the spark so start→end equals changePct around the reference price.
  const series = d.spark.map((v) => {
    const t = (v - first) / (last - first || 1);
    return Number((base * (1 + (changePct / 100) * t)).toFixed(4));
  });
  return { series, changePct, asOf: new Date(0).toISOString() };
}
