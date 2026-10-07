// Vera, in the BNB Chain demo: turns a goal and an amount into a plan the way the real broker
// does, without an AI call. She plans only from stocks buyable right now, picks for each the
// issuer whose price sits closest to the real share, keeps every stock at $6 or more, never
// reaches for a leveraged fund, and refuses (in plain words) when the US market is shut.
// Pure functions of the demo catalog, so the rules are tested.
import { parseUnits } from "viem";
import { BSC } from "@/lib/chains/bsc";
import { assetBySymbol } from "@/lib/chains";
import type { Allocation } from "@/lib/allocation-schema";
import type { AllocateResult, InvestSuccess } from "@/lib/invest-types";
import type { DryRun } from "@/lib/dryRun";
import { displayFor } from "@/lib/displayAssets";
import { formatOpensLocal, nextUsOpenMs } from "@/lib/marketHours";
import { BSC_MIN_LEG_USD, type RwaListResponse, type RwaTickerView } from "@/lib/rwa";
import { hx } from "@/lib/demo/hex";
import { demoRefPrice } from "@/lib/demo/bscRef";
import { demoDryRun } from "@/lib/demo/bscMarket";
import type { DemoFill } from "@/lib/demo/demoTypes";

/** A refusal Vera makes on purpose, worded for the person: the same kind the real server sends as a 4xx. */
export class DemoRefusal extends Error {}

type Risk = "conservative" | "balanced" | "aggressive";

interface Theme {
  test: RegExp;
  picks: string[];
  summary: string;
}

const SAFE_WORDS = /\b(safe|safer|steady|stable|calm|conservative|dividend|slow)\b/i;
const THEMES: Theme[] = [
  { test: /\b(ai|chip|chips|semiconductor|semis|hardware)\b/i, picks: ["NVDA", "AVGO", "TSM", "AMD", "MU", "MRVL"], summary: "A chips-and-AI mix that backs the companies building the hardware." },
  { test: /\b(coin|exchange|fintech|bitcoin stocks|crypto stocks)\b/i, picks: ["COIN", "HOOD", "MSTR", "CRCL"], summary: "Companies that live on the crypto boom, in stock form." },
  { test: /\b(big tech|tech|apple|google|amazon|microsoft|meta)\b/i, picks: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META"], summary: "A big-tech mix of companies you already use every day." },
  { test: SAFE_WORDS, picks: ["SPY", "QQQ", "MSFT", "AAPL", "IBM"], summary: "A steady mix: broad funds first, then a few big, profitable names." },
];
const DEFAULT_PICKS = ["SPY", "NVDA", "AAPL", "MSFT", "GOOGL"];
const DEFAULT_SUMMARY = "A balanced mix that grows over time and doesn't lean on one company.";

const REASONS: Record<string, string> = {
  SPY: "One fund that holds the 500 biggest US companies.",
  QQQ: "A fund of the 100 largest tech-leaning names.",
  NVDA: "Makes the chips most of today's AI runs on.",
  AAPL: "A steady, profitable giant.",
  MSFT: "Office, Windows and a leading cloud, all in one.",
  GOOGL: "Search, YouTube and cloud in one company.",
  AMZN: "The biggest online store, plus the cloud behind half the internet.",
  META: "Instagram, WhatsApp and Facebook, used by billions daily.",
  TSLA: "Electric cars and home batteries, with bigger swings.",
  AVGO: "Designs the networking and custom chips inside data centers.",
  TSM: "Builds most of the world's advanced chips for other brands.",
  AMD: "A challenger in PC and data-center chips.",
  MU: "Makes the memory chips every device and AI server needs.",
  MRVL: "Chips that move data around inside the cloud.",
  IBM: "An old, steady business moving into cloud and AI.",
  COIN: "The biggest US crypto exchange, as a company.",
  HOOD: "A popular app for buying stocks and crypto.",
  MSTR: "A software company known for holding lots of Bitcoin.",
  CRCL: "The company behind the USDC digital dollar.",
  BTCB: "Bitcoin, the original crypto. Expect bigger swings than a stock.",
  ETH: "Ether, the coin that runs most of crypto. Bigger swings than a stock.",
};

function reasonFor(symbol: string): string {
  return REASONS[symbol] ?? `A well-known company in ${displayFor(symbol).cat.toLowerCase()}.`;
}

const CRYPTO_WORDS = /\b(crypto|bitcoin|btc|ethereum|eth)\b|\bbnb\b(?!\s*(smart\s*)?chain)/i;
const CRYPTO_NEGATION = /\b(no|not|without|avoid|never|skip|exclude|zero)\b(?:\s+\S+){0,3}?\s+(crypto|bitcoin|btc|ethereum|eth|bnb)\b/i;

/** How much of the plan the goal asks to hold in crypto: 0 unless it asks, 20 when it just mentions it. */
export function cryptoShareFrom(goal: string): number {
  if (!CRYPTO_WORDS.test(goal) || CRYPTO_NEGATION.test(goal)) return 0;
  const pct = goal.match(/(\d{1,3})\s*%\s*(?:in\s+|of\s+)?(?:crypto|bitcoin|btc|ethereum|eth|bnb)\b/i);
  if (pct) return Math.max(0, Math.min(100, Number(pct[1])));
  if (/mostly\s+(crypto|bitcoin|btc)/i.test(goal)) return 70;
  return 20;
}

/** Whole-number weights for `raw` ratios that add to exactly 100 (largest remainder). */
export function wholeWeights(raw: number[]): number[] {
  const total = raw.reduce((s, x) => s + x, 0) || 1;
  const scaled = raw.map((x) => (x / total) * 100);
  const floors = scaled.map(Math.floor);
  let left = 100 - floors.reduce((s, x) => s + x, 0);
  const order = scaled.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

const SHAPES: Record<Risk | "simple", number[]> = {
  balanced: [34, 26, 22, 18],
  conservative: [30, 28, 22, 20],
  aggressive: [50, 30, 20],
  simple: [60, 40],
};

const TIER_RISK = { etf: 3600, stock: 5900, crypto: 8200 } as const;

function isBuyable(t: RwaTickerView | undefined): t is RwaTickerView {
  return Boolean(t && t.bestVenue !== null);
}

export interface DemoPlanArgs {
  goal: string;
  amountUsd: number;
  risk?: string;
  rwa: RwaListResponse;
  nowMs: number;
}

/** Vera's BNB Chain plan, or a DemoRefusal worded for the person. */
export function demoBscAllocate({ goal, amountUsd, risk, rwa, nowMs }: DemoPlanArgs): AllocateResult {
  if (!Number.isFinite(amountUsd) || amountUsd < BSC_MIN_LEG_USD) {
    throw new DemoRefusal(`The smallest amount per stock is $${BSC_MIN_LEG_USD}. Try $${BSC_MIN_LEG_USD} or more.`);
  }
  const tone: Risk = risk === "conservative" || risk === "aggressive" ? risk : "balanced";
  const simple = /keep it simple/i.test(goal);
  const theme = THEMES.find((t) => t.test.test(goal));
  const wantsCrypto = cryptoShareFrom(goal);

  let picks = theme?.picks ?? DEFAULT_PICKS;
  // "Keep a little safe" next to another theme: lead with the broad fund, then that theme's names.
  if ((tone === "conservative" || (theme && theme.test !== SAFE_WORDS && SAFE_WORDS.test(goal))) && !picks.includes("SPY")) picks = ["SPY", ...picks];
  if (tone === "aggressive") picks = [...picks].sort((a, b) => (displayFor(b).day - displayFor(a).day));
  const open = picks.filter((s) => {
    const a = assetBySymbol(BSC, s);
    return a && a.risk !== "leveraged" && isBuyable(rwa.tickers.find((t) => t.ticker === s));
  });

  const cryptoShare = open.length === 0 && wantsCrypto === 0 ? 0 : wantsCrypto;
  if (open.length === 0 && cryptoShare === 0) {
    const when = formatOpensLocal(nextUsOpenMs(nowMs), nowMs);
    throw new DemoRefusal(
      `The US stock market is closed right now; it ${when}. Vera doesn't buy a stock at a closed-market premium. Ask for some crypto, which trades all day, or come back then.`,
    );
  }
  const stockShare = open.length === 0 ? 0 : 100 - cryptoShare;

  const shape = SHAPES[simple ? "simple" : tone];
  const stockPicks = open.slice(0, Math.min(shape.length, open.length));
  const cryptoPicks = cryptoShare > 0 ? (cryptoShare >= 30 ? ["BTCB", "ETH"] : ["BTCB"]) : [];

  type Leg = { symbol: string; weight: number };
  let legs: Leg[] = [
    ...stockPicks.map((symbol, i) => ({ symbol, weight: (shape[i] / shape.slice(0, stockPicks.length).reduce((s, x) => s + x, 0)) * stockShare })),
    ...cryptoPicks.map((symbol, i) => ({ symbol, weight: cryptoPicks.length === 2 ? (i === 0 ? 0.6 : 0.4) * cryptoShare : cryptoShare })),
  ].filter((l) => l.weight > 0);

  // $6 a stock: drop the smallest until every one clears it, never below one stock.
  for (;;) {
    const total = legs.reduce((s, l) => s + l.weight, 0);
    const smallest = Math.min(...legs.map((l) => (l.weight / total) * amountUsd));
    if (smallest >= BSC_MIN_LEG_USD - 1e-9 || legs.length === 1) break;
    const drop = legs.reduce((m, l, i) => (l.weight < legs[m].weight ? i : m), 0);
    legs = legs.filter((_, i) => i !== drop);
  }
  const whole = wholeWeights(legs.map((l) => l.weight));
  const allocations: Allocation["allocations"] = legs.map((l, i) => {
    const ticker = rwa.tickers.find((t) => t.ticker === l.symbol);
    const venue = ticker?.bestVenue ?? undefined;
    const address = venue ? ticker?.venues.find((v) => v.platform === venue)?.address : assetBySymbol(BSC, l.symbol)?.address;
    return {
      symbol: l.symbol,
      weightPct: whole[i],
      reason: reasonFor(l.symbol),
      ...(venue ? { venue } : {}),
      ...(address ? { address } : {}),
    };
  });

  const riskScore = Math.round(
    allocations.reduce((s, a) => {
      const t = rwa.tickers.find((x) => x.ticker === a.symbol);
      const tier = assetBySymbol(BSC, a.symbol)?.tier === "crypto" ? "crypto" : t?.type === "etf" ? "etf" : "stock";
      return s + (a.weightPct / 100) * TIER_RISK[tier];
    }, 0),
  );

  const stocksOnly = stockShare === 100;
  const summary = stockShare === 0 ? "Crypto only, because the stock market is closed." : (theme?.summary ?? DEFAULT_SUMMARY);
  const rationale =
    stockShare === 0
      ? "The US market is closed, so I'm not buying stocks at a closed-market price. Crypto trades all day, so this plan is only crypto. Ask again when the market opens for a mix with stocks."
      : `${stocksOnly ? "" : "A small slice goes to crypto, as you asked. "}I only picked stocks that can be bought right now, and for each one the issuer whose price is closest to the real share. Stocks can go down as well as up, so keep this to money you can leave alone for a while.`;

  return { summary, rationale, riskScore, allocations, amountUsd, model: "demo", chain: "bsc" };
}

// ── What placing the plan looks like ────────────────────────────────────────

/** A deterministic, plausible-looking transaction hash for the n-th thing the visitor did. */
export function demoTxHash(n: number): `0x${string}` {
  return hx(`demo-session-${n}`);
}

/** What each stock of a plan buys at the issuer's current price, 0.15% worse than it, for the check and the receipt. */
export function demoPlanLegs(alloc: Pick<Allocation, "allocations">, amountUsd: number, rwa: RwaListResponse) {
  return alloc.allocations.map((a) => {
    const usd = Number(((amountUsd * a.weightPct) / 100).toFixed(2));
    const t = rwa.tickers.find((x) => x.ticker === a.symbol);
    const view = t?.venues.find((v) => v.platform === (a.venue ?? t.bestVenue ?? t.venues[0]?.platform)) ?? t?.venues[0];
    const price = view?.tokenPrice ?? demoRefPrice(a.symbol) ?? 1;
    const qty = (usd / price) * (1 - 0.0015);
    const asset = assetBySymbol(BSC, a.symbol);
    return { symbol: a.symbol, venue: view?.platform, usd, qty, address: (view?.address ?? asset?.address) as `0x${string}` };
  });
}

/** Binance's check on every leg of the plan, as it reads when each passes. */
export function demoBscDryRuns(alloc: Pick<Allocation, "allocations">, amountUsd: number, rwa: RwaListResponse, nowMs: number): DryRun[] {
  return demoPlanLegs(alloc, amountUsd, rwa).map((l) =>
    demoDryRun(l.symbol, l.address, parseUnits(l.qty.toFixed(6), 18), nowMs),
  );
}

/** The session fills a placed plan leaves behind: one buy per stock, all in one transaction. */
export function demoBscPlanFills(alloc: Pick<Allocation, "allocations">, amountUsd: number, rwa: RwaListResponse, txHash: `0x${string}`): DemoFill[] {
  return demoPlanLegs(alloc, amountUsd, rwa).map((l): DemoFill => {
    const asset = assetBySymbol(BSC, l.symbol);
    return {
      kind: "trade",
      side: "buy",
      symbol: l.symbol,
      ...(asset?.tier !== "crypto" && l.venue ? { venue: l.venue } : {}),
      usd: l.usd,
      qty: l.qty,
      txHash,
    };
  });
}

/** The receipt Success shows. No on-chain verification panel: on BNB Chain a plan is checked with Binance, not signed on a contract. */
export function demoBscSuccess(alloc: Allocation, amountUsd: number, txHash: `0x${string}`): InvestSuccess {
  return {
    txHash,
    amountUsd,
    holdings: alloc.allocations.map((a) => ({
      symbol: a.symbol,
      name: displayFor(a.symbol, assetBySymbol(BSC, a.symbol)?.name).name,
      weightPct: a.weightPct,
      amountUsd: (amountUsd * a.weightPct) / 100,
    })),
  };
}
