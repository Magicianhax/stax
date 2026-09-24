// bscPlan.ts holds the two rules Review Focus #1 and #3 pin for Vera on BSC: never allocate
// into a ticker nothing will buy right now, and never let a leg size under Binance's $6 floor
// reach a quote. Both are exercised here as plain data transforms — no LLM, no live Binance
// call — per superpowers:test-driven-development ("mock the LLM the way existing allocate
// tests do" doesn't apply here: these functions never see the model at all).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./binance", () => ({ getBinanceWeb3: vi.fn() }));

import { getBinanceWeb3 } from "./binance";
import { getChain } from "@/lib/chains";
import { usdToRaw } from "@/lib/units";
import type { RwaToken } from "./binance/types";
import type { RwaTickerView, VenueView } from "@/lib/rwa";
import { allClosedMessage, buildBscInvestCalls, buyableTickers, closedMessage, enforceMinLegs, maxBscLegs, venueAddressFor } from "./bscPlan";

const bsc = getChain("bsc");
const NVDA = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as const;
const NVDA_ONDO = "0xa9ee28c80f960b889dfbd1902055218cba016f75" as const;
const MSFT = "0x80106cb3ead06659a5ad19df39d9b4733863b9b0" as const;
const SMART_ACCOUNT = "0x1111111111111111111111111111111111111a" as const;
const NOW = Date.parse("2026-09-24T15:00:00.000Z"); // a Thursday, US market open

function venue(overrides: Partial<VenueView> = {}): VenueView {
  return {
    platform: "bstock",
    symbol: "NVDAB",
    address: NVDA,
    tokenPrice: 200,
    referencePrice: 200,
    gapPct: 0,
    state: "open",
    buyable: true,
    nextOpenMs: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function ticker(overrides: Partial<RwaTickerView> = {}): RwaTickerView {
  return {
    ticker: "NVDA",
    name: "Nvidia",
    type: "stock",
    venues: [venue()],
    bestVenue: "bstock",
    ...overrides,
  };
}

describe("maxBscLegs", () => {
  it("floors to how many $6 legs fit", () => {
    expect(maxBscLegs(60)).toBe(10);
    expect(maxBscLegs(20)).toBe(3);
    expect(maxBscLegs(6)).toBe(1);
    expect(maxBscLegs(5.99)).toBe(0);
  });

  it("is 0 for a non-positive or non-finite amount", () => {
    expect(maxBscLegs(0)).toBe(0);
    expect(maxBscLegs(-10)).toBe(0);
    expect(maxBscLegs(Number.NaN)).toBe(0);
  });
});

describe("venueAddressFor", () => {
  it("returns the bestVenue row's own address", () => {
    const t = ticker({
      venues: [venue({ platform: "bstock", address: NVDA }), venue({ platform: "ondo", address: NVDA_ONDO, gapPct: 2 })],
      bestVenue: "bstock",
    });
    expect(venueAddressFor(t)).toBe(NVDA);
  });

  it("follows bestVenue to the twin when Ondo is the pick", () => {
    const t = ticker({
      venues: [venue({ platform: "bstock", address: NVDA, gapPct: 3 }), venue({ platform: "ondo", address: NVDA_ONDO, gapPct: 0.1 })],
      bestVenue: "ondo",
    });
    expect(venueAddressFor(t)).toBe(NVDA_ONDO);
  });

  it("is null when nothing is buyable (bestVenue null) or the ticker is missing", () => {
    expect(venueAddressFor(ticker({ bestVenue: null }))).toBeNull();
    expect(venueAddressFor(undefined)).toBeNull();
  });
});

describe("buyableTickers", () => {
  it("keeps only tickers with a buyable venue right now", () => {
    const open = ticker({ ticker: "NVDA", bestVenue: "bstock" });
    const closed = ticker({ ticker: "TSLA", bestVenue: null, venues: [venue({ buyable: false, state: "closed" })] });
    expect(buyableTickers([open, closed]).map((t) => t.ticker)).toEqual(["NVDA"]);
  });
});

describe("closedMessage", () => {
  it("names the soonest open time across every venue", () => {
    const laterMs = NOW + 3 * 3600_000;
    const soonerMs = NOW + 3600_000;
    const t = ticker({
      ticker: "TSLA",
      bestVenue: null,
      venues: [venue({ buyable: false, nextOpenMs: laterMs }), venue({ platform: "ondo", buyable: false, nextOpenMs: soonerMs })],
    });
    const msg = closedMessage("TSLA", t, NOW);
    expect(msg).toMatch(/^TSLA is closed right now; it opens/);
  });

  it("falls back to the US calendar when the ticker or its venues carry no next-open time", () => {
    expect(closedMessage("TSLA", undefined, NOW)).toMatch(/closed right now/);
  });
});

describe("allClosedMessage", () => {
  it("names the soonest reopen across the whole catalog, never an empty-plan silence", () => {
    const soon = ticker({ ticker: "NVDA", bestVenue: null, venues: [venue({ buyable: false, nextOpenMs: NOW + 3600_000 })] });
    const later = ticker({ ticker: "MSFT", bestVenue: null, venues: [venue({ buyable: false, nextOpenMs: NOW + 7200_000 })] });
    const msg = allClosedMessage([soon, later], NOW);
    expect(msg).toMatch(/closed/i);
    expect(msg).toMatch(/opens/);
  });

  it("falls back to the US calendar when no ticker carries a next-open time", () => {
    expect(allClosedMessage([], NOW)).toMatch(/closed/i);
  });
});

describe("enforceMinLegs", () => {
  it("passes through legs that already clear $6 each", () => {
    const legs = [
      { symbol: "NVDA", usd: 30 },
      { symbol: "MSFT", usd: 30 },
      { symbol: "GOOGL", usd: 40 },
    ];
    const result = enforceMinLegs(legs, 100);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.legs).toHaveLength(3);
      expect(result.legs.reduce((s, l) => s + l.usd, 0)).toBeCloseTo(100, 6);
    }
  });

  it("drops the smallest legs down to floor(usd/6) and renormalises the rest", () => {
    // $20 only fits 3 legs of $6+, so the smallest of 5 equal-weighted candidates are dropped.
    const legs = Array.from({ length: 5 }, (_, i) => ({ symbol: `S${i}`, usd: 4 }));
    const result = enforceMinLegs(legs, 20);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.legs).toHaveLength(3);
      for (const l of result.legs) expect(l.usd).toBeGreaterThanOrEqual(6);
      expect(result.legs.reduce((s, l) => s + l.usd, 0)).toBeCloseTo(20, 6);
    }
  });

  it("refuses, naming $6, when the amount can't fund even one leg", () => {
    const result = enforceMinLegs([{ symbol: "NVDA", usd: 5 }], 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/\$6/);
  });

  it("refuses when a heavily skewed weighting leaves a kept leg under $6 even after renormalising", () => {
    // 2 legs fit ($20/6=3, so both survive), but a 97/3 split still leaves one leg at $0.60.
    const legs = [
      { symbol: "NVDA", usd: 19.4 },
      { symbol: "MSFT", usd: 0.6 },
    ];
    const result = enforceMinLegs(legs, 20);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/\$6/);
  });

  it("refuses with no empty-plan silence when there are no candidate legs at all", () => {
    const result = enforceMinLegs([], 100);
    expect(result.ok).toBe(false);
  });
});

function row(overrides: Partial<RwaToken> = {}): RwaToken {
  return {
    binanceChainId: "56",
    tokenContractAddress: NVDA,
    platformId: "bstock",
    assetType: 1,
    tokenName: "Nvidia",
    tokenSymbol: "NVDAB",
    tokenLogoUrl: "",
    decimals: 18,
    underlyingTicker: "NVDA",
    underlyingName: "Nvidia",
    tokenToShareRatio: 1,
    statusInfo: {
      openState: true,
      marketStatus: "regular",
      reasonCode: "TRADING",
      reasonMsg: null,
      nextOpenTime: null,
      nextCloseTime: null,
    },
    tokenPrice: 200,
    referencePrice: 200,
    volume24H: 0,
    marketCap: 0,
    ...overrides,
  };
}

const quoteSpy = vi.fn();
const buildSwapSpy = vi.fn();

const goodQuote = {
  quoteId: "q1",
  vendorName: "LiquidMesh",
  executionMode: "SWAP" as const,
  fromTokenAmount: BigInt(0), // overwritten per-call below
  toTokenAmount: BigInt(1000),
  priceImpactPercent: 0.01,
  approveTarget: bsc.routers.binance!,
  raw: {},
};

const goodSwap = {
  executionMode: "SWAP" as const,
  tx: {
    from: SMART_ACCOUNT,
    to: bsc.routers.binance!,
    data: "0xdeadbeef" as const,
    value: "0",
    gas: "450000",
    gasPrice: "1",
    minReceiveAmount: BigInt(990),
  },
};

describe("buildBscInvestCalls", () => {
  beforeEach(() => {
    quoteSpy.mockReset().mockImplementation(async (p: { amount: bigint }) => ({ ...goodQuote, fromTokenAmount: p.amount }));
    buildSwapSpy.mockReset().mockResolvedValue(goodSwap);
    vi.mocked(getBinanceWeb3).mockReturnValue({
      quote: quoteSpy,
      buildSwap: buildSwapSpy,
    } as unknown as ReturnType<typeof getBinanceWeb3>);
  });

  const allocation = {
    summary: "s",
    rationale: "r",
    riskScore: 6000,
    allocations: [
      { symbol: "NVDA", weightPct: 60, reason: "why" },
      { symbol: "MSFT", weightPct: 40, reason: "why" },
    ],
  };

  const catalog: RwaTickerView[] = [
    ticker({ ticker: "NVDA", bestVenue: "bstock", venues: [venue({ address: NVDA })] }),
    ticker({ ticker: "MSFT", name: "Microsoft", bestVenue: "bstock", venues: [venue({ address: MSFT, symbol: "MSFTB" })] }),
  ];
  const tokens: RwaToken[] = [row({ tokenContractAddress: NVDA }), row({ tokenContractAddress: MSFT, tokenSymbol: "MSFTB" })];

  it("returns an approve + swap for every leg, targeting only cash, the venue, or the router", async () => {
    const calls = await buildBscInvestCalls({
      chain: bsc,
      allocation,
      usdcTotal: usdToRaw(bsc, 100),
      taker: SMART_ACCOUNT,
      catalog,
      tokens,
      nowMs: NOW,
    });
    expect(calls).toHaveLength(4); // 2 legs * (approve + swap)
    const allowed = new Set([bsc.usdc.address.toLowerCase(), bsc.routers.binance!.toLowerCase()]);
    for (const call of calls) expect(allowed.has(call.to.toLowerCase())).toBe(true);
  });

  it("fails the whole plan, naming the leg and the closed market, when one venue isn't buyable right now", async () => {
    const closedCatalog = [
      catalog[0],
      { ...catalog[1], bestVenue: null, venues: [venue({ address: MSFT, buyable: false, state: "closed" as const })] },
    ];
    const err = await buildBscInvestCalls({
      chain: bsc,
      allocation,
      usdcTotal: usdToRaw(bsc, 100),
      taker: SMART_ACCOUNT,
      catalog: closedCatalog,
      tokens,
      nowMs: NOW,
    }).catch((e) => e);
    expect(err.message).toMatch(/MSFT/);
    expect(err.message).toMatch(/closed/i);
  });

  it("still names the closed market and never returns partial calls when every leg is closed", async () => {
    const allClosed = catalog.map((t) => ({ ...t, bestVenue: null, venues: [venue({ address: t.venues[0].address, buyable: false, state: "closed" as const })] }));
    const err = await buildBscInvestCalls({
      chain: bsc,
      allocation,
      usdcTotal: usdToRaw(bsc, 100),
      taker: SMART_ACCOUNT,
      catalog: allClosed,
      tokens,
      nowMs: NOW,
    }).catch((e) => e);
    expect(err.message).toMatch(/closed/i);
  });

  it("never returns a partial batch — a mid-loop rejection surfaces before any call is used", async () => {
    // checkBscBuyable passes (row present + TRADING) but the cached tokens list is stale and
    // no longer lists MSFT at all — fails closed rather than silently dropping the leg.
    const staleTokens = [row({ tokenContractAddress: NVDA })];
    await expect(
      buildBscInvestCalls({ chain: bsc, allocation, usdcTotal: usdToRaw(bsc, 100), taker: SMART_ACCOUNT, catalog, tokens: staleTokens, nowMs: NOW }),
    ).rejects.toThrow(/MSFT/);
  });
});
