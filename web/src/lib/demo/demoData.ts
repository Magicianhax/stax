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
import type { GiftHolding, GiftPreview, GiftSummary, GiftToken } from "@/lib/gifts";
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
// Fills per demo plan (dollars in → units out at the reference prices), so the
// receipt can show exactly what was bought.
const legsFor = (split: [string, number][]) =>
  split.map(([symbol, usdcIn]) => ({ symbol, usdcIn, qty: Number((usdcIn / (displayFor(symbol).price || 1)).toFixed(symbol === "aUSDC" ? 2 : 4)) }));
export const DEMO_ACTIVITY: ActivityRow[] = [
  { kind: "invest", usdc: 300, legCount: 4, txHash: hx("7b41a9c0"), blockNumber: BigInt(0), timestamp: ago(0, 9, 12), symbols: PLAN_A, legs: legsFor([["NVDA", 90], ["AAPL", 75], ["GOOGL", 75], ["aUSDC", 60]]) },
  { kind: "invest", usdc: 150, legCount: 3, txHash: hx("910e7f22"), blockNumber: BigInt(0), timestamp: ago(24, 16, 40), symbols: PLAN_B, legs: legsFor([["AAPL", 60], ["GOOGL", 60], ["aUSDC", 30]]) },
  { kind: "invest", usdc: 500, legCount: 4, txHash: hx("a27c1043"), blockNumber: BigInt(0), timestamp: ago(48, 11, 5), symbols: PLAN_A, legs: legsFor([["NVDA", 150], ["AAPL", 125], ["GOOGL", 125], ["aUSDC", 100]]) },
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

const DEMO_RANGE_SCALE: Record<MarketRange, number> = { "1D": 1, "1W": 2.4, "1M": 4.1, "1Y": 13, "5Y": 22 };

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


// ── Gifts (demo) ──────────────────────────────────────────────────────────────
// Seeded gifts so the give / view / claim flow works end to end with no API and
// no chain: one waiting to unlock, one ready to claim, one already claimed, plus
// a returned one so every status the UI can draw is exercised. Appended, never
// edited into the consts above. Shapes come from @/lib/gifts (gift-chain owns
// them), so the demo and the real thing render through the same code.

/** ISO timestamp, `days` from the fixed demo "now" (negative = in the past). */
function isoIn(days: number): string {
  return new Date(DEMO_NOW + days * DAY * 1000).toISOString();
}

/** A parked holding: dollars converted to raw token units at the reference price. */
function giftToken(symbol: string, usd: number): GiftToken {
  const asset = assetOf(symbol);
  const dec = asset.decimals ?? 18;
  const price = displayFor(symbol).price ?? 1;
  return {
    symbol,
    address: asset.address as `0x${string}`,
    amount: parseUnits((usd / price).toFixed(Math.min(dec, 8)), dec).toString(),
  };
}

const giftTokens = (split: [string, number][]): GiftToken[] => split.map(([s, u]) => giftToken(s, u));

/** The same split as weights — what the basket holds, with no amounts. */
function giftHoldings(split: [string, number][]): GiftHolding[] {
  const total = split.reduce((sum, [, u]) => sum + u, 0) || 1;
  return split.map(([symbol, u]) => ({ symbol, weightPct: Math.round((u / total) * 100) }));
}

const giftId = (tag: string): `0x${string}` => hx(tag);

export const DEMO_GIFTS: GiftSummary[] = [
  {
    id: giftId("41d9c7b2"),
    chain: "base",
    direction: "received",
    status: "funded",
    basketId: "base:ai-chips",
    basketName: "AI & Chips",
    amountUsd: 150,
    note: "Happy birthday. A year of the companies you kept talking about.",
    unlockAt: isoIn(-2),
    reclaimAfter: isoIn(88),
    createdAt: isoIn(-367),
    tokens: giftTokens([["NVDA", 74.81], ["GOOGL", 37.4], ["META", 37.4]]),
    holdings: giftHoldings([["NVDA", 74.81], ["GOOGL", 37.4], ["META", 37.4]]),
    createTxHash: hx("8f3b21c4"),
    claimTxHash: null,
    recipientEmailMasked: null,
    fromName: "Maya",
    claimable: true,
    reclaimable: false,
    shareUrl: null,
  },
  {
    id: giftId("bd47e103"),
    chain: "base",
    direction: "received",
    status: "funded",
    basketId: "base:bitcoin-blue-chips",
    basketName: "Bitcoin & Blue Chips",
    amountUsd: 60,
    note: null,
    unlockAt: isoIn(214),
    reclaimAfter: isoIn(304),
    createdAt: isoIn(-9),
    tokens: giftTokens([["BTC", 20.95], ["AAPL", 14.96], ["NVDA", 11.97], ["GOOGL", 11.97]]),
    holdings: giftHoldings([["BTC", 20.95], ["AAPL", 14.96], ["NVDA", 11.97], ["GOOGL", 11.97]]),
    createTxHash: hx("c1a90e57"),
    claimTxHash: null,
    recipientEmailMasked: null,
    fromName: "Tom",
    claimable: false,
    reclaimable: false,
    shareUrl: null,
  },
  {
    id: giftId("7e2b45af"),
    chain: "base",
    direction: "sent",
    status: "funded",
    basketId: "base:big-tech",
    basketName: "Big Tech",
    amountUsd: 250,
    note: "For Lena, on her 18th. Leave it alone and let it grow. Love, Dad.",
    unlockAt: isoIn(6574),
    reclaimAfter: isoIn(6664),
    createdAt: isoIn(-12),
    tokens: giftTokens([["AAPL", 74.81], ["GOOGL", 62.34], ["NVDA", 62.34], ["META", 49.88]]),
    holdings: giftHoldings([["AAPL", 74.81], ["GOOGL", 62.34], ["NVDA", 62.34], ["META", 49.88]]),
    createTxHash: hx("3d81ba60"),
    claimTxHash: null,
    recipientEmailMasked: "l•••@gmail.com",
    fromName: null,
    claimable: false,
    reclaimable: false,
    shareUrl: null,
  },
  {
    id: giftId("2a6e90fd"),
    chain: "base",
    direction: "sent",
    status: "claimed",
    basketId: "base:safe-growth",
    basketName: "Safe Growth",
    amountUsd: 100,
    note: "Congratulations on the new job.",
    unlockAt: isoIn(-31),
    reclaimAfter: isoIn(59),
    createdAt: isoIn(-398),
    tokens: giftTokens([["aUSDC", 39.9], ["AAPL", 19.95], ["GOOGL", 19.95], ["NVDA", 19.95]]),
    holdings: giftHoldings([["aUSDC", 39.9], ["AAPL", 19.95], ["GOOGL", 19.95], ["NVDA", 19.95]]),
    createTxHash: hx("9b0c7e34"),
    claimTxHash: hx("5f6a2d18"),
    recipientEmailMasked: "j•••@icloud.com",
    fromName: null,
    claimable: false,
    reclaimable: false,
    shareUrl: null,
  },
  {
    id: giftId("6c0af58e"),
    chain: "base",
    direction: "sent",
    status: "reclaimed",
    basketId: "base:ai-chips",
    basketName: "AI & Chips",
    amountUsd: 75,
    note: "Wrong address, sorry.",
    unlockAt: isoIn(-190),
    reclaimAfter: isoIn(-100),
    createdAt: isoIn(-462),
    tokens: giftTokens([["NVDA", 37.4], ["GOOGL", 18.7], ["META", 18.7]]),
    holdings: giftHoldings([["NVDA", 37.4], ["GOOGL", 18.7], ["META", 18.7]]),
    createTxHash: hx("e408c1b7"),
    claimTxHash: hx("70d3f9a2"),
    recipientEmailMasked: "s•••@outlook.com",
    fromName: null,
    claimable: false,
    reclaimable: false,
    shareUrl: null,
  },
];

/** The public preview of a demo gift, for the share page in development. */
export function demoGiftPreview(id: string): GiftPreview | null {
  const g = DEMO_GIFTS.find((x) => x.id === id);
  if (!g) return null;
  return {
    id: g.id,
    chain: g.chain,
    basketName: g.basketName,
    amountUsd: g.amountUsd,
    note: g.note,
    unlockAt: g.unlockAt,
    fromName: g.direction === "received" ? g.fromName : "Alex",
    status: g.status,
    claimable: g.claimable,
    holdings: g.holdings,
  };
}
