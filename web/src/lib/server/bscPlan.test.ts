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
import {
  allClosedMessage,
  applyCryptoMix,
  buildBscInvestCalls,
  buyableTickers,
  closedMessage,
  enforceMinLegs,
  maxBscLegs,
  parseCryptoMix,
  unavailableNote,
  venueAddressFor,
} from "./bscPlan";

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

  it("drops a leg that's still under $6 after renormalising, rather than refusing a plan a smaller one would fix", () => {
    // 2 legs fit ($20/6=3, so both survive the count cap), but a 97/3 split leaves MSFT at
    // $0.60. A valid 1-leg plan (NVDA at the full $20) exists, so that's what comes back —
    // refusing outright would throw away a plan the user could actually invest.
    const legs = [
      { symbol: "NVDA", usd: 19.4 },
      { symbol: "MSFT", usd: 0.6 },
    ];
    const result = enforceMinLegs(legs, 20);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.legs).toEqual([{ symbol: "NVDA", usd: 20 }]);
    }
  });

  it("drops down through more than one round when the count cap alone still leaves a leg under $6", () => {
    // All 3 legs fit the count cap ($20/6=3), but a 90/8/2 split leaves the smallest two under
    // $6 even after one renormalisation — it takes two drops to reach a valid plan.
    const legs = [
      { symbol: "NVDA", usd: 18 },
      { symbol: "MSFT", usd: 1.6 },
      { symbol: "GOOGL", usd: 0.4 },
    ];
    const result = enforceMinLegs(legs, 20);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.legs).toHaveLength(1);
      expect(result.legs[0]).toMatchObject({ symbol: "NVDA", usd: 20 });
    }
  });

  it("refuses only when not even the single largest leg can clear $6", () => {
    // $5 total can't fund one $6 leg no matter how much gets dropped.
    const result = enforceMinLegs([{ symbol: "NVDA", usd: 4 }, { symbol: "MSFT", usd: 1 }], 5);
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

describe("unavailableNote", () => {
  it("says a ticker with no Binance venue is unlisted, instead of an empty state list", () => {
    const t: RwaTickerView = { ticker: "TSLA", name: "Tesla", type: "stock", venues: [], bestVenue: null };
    expect(unavailableNote(t, Date.UTC(2026, 8, 27, 12))).toBe("TSLA (not listed by Binance right now)");
  });
});

const BTCB = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" as const;

describe("buildBscInvestCalls: crypto legs", () => {
  beforeEach(() => {
    quoteSpy.mockReset().mockImplementation(async (p: { amount: bigint }) => ({ ...goodQuote, fromTokenAmount: p.amount }));
    buildSwapSpy.mockReset().mockResolvedValue(goodSwap);
    vi.mocked(getBinanceWeb3).mockReturnValue({
      quote: quoteSpy,
      buildSwap: buildSwapSpy,
    } as unknown as ReturnType<typeof getBinanceWeb3>);
  });

  it("builds a crypto leg straight from the asset's own address — no RWA catalog, no market-hours gate", async () => {
    // Neither the catalog nor the tokens list carries BTCB at all (it isn't an RWA token), and
    // this must still succeed: crypto is always tradeable (Wave 5 direction A).
    const calls = await buildBscInvestCalls({
      chain: bsc,
      allocation: { summary: "s", rationale: "r", riskScore: 7000, allocations: [{ symbol: "BTCB", weightPct: 100, reason: "why" }] },
      usdcTotal: usdToRaw(bsc, 60),
      taker: SMART_ACCOUNT,
      catalog: [],
      tokens: [],
      nowMs: NOW,
    });
    expect(calls).toHaveLength(2); // approve + swap
    const allowed = new Set([bsc.usdc.address.toLowerCase(), bsc.routers.binance!.toLowerCase()]);
    for (const call of calls) expect(allowed.has(call.to.toLowerCase())).toBe(true);
    expect(quoteSpy).toHaveBeenCalledWith(expect.objectContaining({ toToken: BTCB }));
  });

  it("mixes a crypto leg and a stock leg in one plan without either blocking the other", async () => {
    const catalog: RwaTickerView[] = [ticker({ ticker: "NVDA", bestVenue: "bstock", venues: [venue({ address: NVDA })] })];
    const tokens: RwaToken[] = [row({ tokenContractAddress: NVDA })];
    const calls = await buildBscInvestCalls({
      chain: bsc,
      allocation: {
        summary: "s",
        rationale: "r",
        riskScore: 7000,
        allocations: [
          { symbol: "NVDA", weightPct: 80, reason: "why" },
          { symbol: "BTCB", weightPct: 20, reason: "why" },
        ],
      },
      usdcTotal: usdToRaw(bsc, 100),
      taker: SMART_ACCOUNT,
      catalog,
      tokens,
      nowMs: NOW,
    });
    expect(calls).toHaveLength(4); // 2 legs * (approve + swap)
  });
});

describe("parseCryptoMix", () => {
  it("returns null when crypto isn't mentioned — the default stays stocks-only", () => {
    expect(parseCryptoMix("grow my savings")).toBeNull();
    expect(parseCryptoMix("mostly big tech stocks")).toBeNull();
  });

  it("reads an explicit crypto percentage", () => {
    expect(parseCryptoMix("80% stocks, 20% crypto")).toEqual({ cryptoPct: 20 });
    expect(parseCryptoMix("put 15% in bitcoin, the rest in stocks")).toEqual({ cryptoPct: 15 });
  });

  it("derives the crypto share from an explicit stock percentage", () => {
    expect(parseCryptoMix("90% stocks and some bitcoin")).toEqual({ cryptoPct: 10 });
  });

  it("maps a half-and-half phrasing to 50/50", () => {
    expect(parseCryptoMix("half stocks, half bitcoin")).toEqual({ cryptoPct: 50 });
    expect(parseCryptoMix("50/50 stocks and crypto")).toEqual({ cryptoPct: 50 });
  });

  it("maps 'mostly crypto' higher than 'a bit of crypto'", () => {
    const mostly = parseCryptoMix("mostly crypto")!;
    const aBit = parseCryptoMix("mostly stocks with a bit of bitcoin")!;
    expect(mostly.cryptoPct).toBeGreaterThan(aBit.cryptoPct);
    expect(aBit.cryptoPct).toBeLessThanOrEqual(20);
  });

  it("gives crypto mentioned with no split at all a modest, non-zero default", () => {
    const mix = parseCryptoMix("stocks and bitcoin")!;
    expect(mix.cryptoPct).toBeGreaterThan(0);
    expect(mix.cryptoPct).toBeLessThan(50);
  });

  it("treats a negated crypto mention as no request at all, not the catch-all default", () => {
    expect(parseCryptoMix("no crypto please")).toBeNull();
    expect(parseCryptoMix("stocks only, avoid bitcoin")).toBeNull();
    expect(parseCryptoMix("I don't want bitcoin")).toBeNull();
    expect(parseCryptoMix("tech stocks, never touch btc")).toBeNull();
  });

  it("never reads 'BNB Chain' (the network name) as a request for the BNB coin", () => {
    expect(parseCryptoMix("invest $100 in tech stocks on BNB Chain")).toBeNull();
    expect(parseCryptoMix("buy some ETFs on BNB Smart Chain")).toBeNull();
  });

  it("still reads bare 'bnb' as the coin when it isn't naming the chain", () => {
    expect(parseCryptoMix("put a bit of bnb in with my stocks")).not.toBeNull();
  });
});

describe("applyCryptoMix", () => {
  it("leaves the plan alone when it's already within tolerance of the target", () => {
    const legs = [
      { symbol: "NVDA", weightPct: 78 },
      { symbol: "BTCB", weightPct: 22 },
    ];
    expect(applyCryptoMix(bsc, legs, { cryptoPct: 20 })).toEqual(legs);
  });

  it("rescales stock and crypto legs onto the requested split, keeping each group's own relative weights", () => {
    const legs = [
      { symbol: "NVDA", weightPct: 30 },
      { symbol: "MSFT", weightPct: 30 },
      { symbol: "BTCB", weightPct: 40 },
    ];
    const out = applyCryptoMix(bsc, legs, { cryptoPct: 20 });
    const crypto = out.find((l) => l.symbol === "BTCB")!;
    const nvda = out.find((l) => l.symbol === "NVDA")!;
    const msft = out.find((l) => l.symbol === "MSFT")!;
    expect(crypto.weightPct).toBeCloseTo(20, 5);
    expect(nvda.weightPct).toBeCloseTo(msft.weightPct, 5); // NVDA/MSFT started equal, stay equal
    expect(nvda.weightPct + msft.weightPct).toBeCloseTo(80, 5);
  });

  it("adds a fallback crypto pick when the model asked-for crypto but included none", () => {
    const legs = [
      { symbol: "NVDA", weightPct: 60 },
      { symbol: "MSFT", weightPct: 40 },
    ];
    const out = applyCryptoMix(bsc, legs, { cryptoPct: 20 });
    const cryptoTotal = out.filter((l) => ["BTCB", "ETH", "BNB"].includes(l.symbol)).reduce((s, l) => s + l.weightPct, 0);
    expect(cryptoTotal).toBeCloseTo(20, 5);
  });

  it("does nothing when the target is ~0% crypto and none was picked — there's nothing to add", () => {
    const legs = [{ symbol: "NVDA", weightPct: 100 }];
    expect(applyCryptoMix(bsc, legs, { cryptoPct: 2 })).toEqual(legs);
  });
});
