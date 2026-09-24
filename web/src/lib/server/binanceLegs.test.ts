// buildBinanceLeg is the one place that turns a Binance aggregator response into something
// Stax will sign: Review Focus #5 (reject RFQ, reject an unrecognised router) and the $6 floor
// live here. getBinanceWeb3() is mocked — these tests pin buildBinanceLeg's own logic, not the
// signed client (see server/binance/client.test.ts) or the retry queue (rateLimit.ts), which
// Task 6 already covers.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./binance", () => ({ getBinanceWeb3: vi.fn() }));

import { getBinanceWeb3 } from "./binance";
import { BinanceWeb3Error } from "./binance/types";
import { getChain } from "@/lib/chains";
import { usdToRaw } from "@/lib/units";
import { assetBySymbol } from "@/lib/chains";
import type { RwaToken } from "./binance/types";
import {
  BinanceLegError,
  bscLegUsdValue,
  buildBinanceLeg,
  checkBscBuyable,
  directCallsForLeg,
  type BinanceLeg,
} from "./binanceLegs";

const bsc = getChain("bsc");
const BINANCE_ROUTER = bsc.routers.binance!;
const NVDA = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as const;
const SMART_ACCOUNT = "0x1111111111111111111111111111111111111a" as const;

const quoteSpy = vi.fn();
const buildSwapSpy = vi.fn();

function args(overrides: Partial<Parameters<typeof buildBinanceLeg>[0]> = {}) {
  return {
    chain: bsc,
    symbol: "NVDA",
    tokenIn: bsc.usdc.address,
    tokenOut: NVDA,
    amountIn: usdToRaw(bsc, 10),
    taker: SMART_ACCOUNT,
    slippageBps: 100,
    usdValue: 10,
    ...overrides,
  };
}

const goodQuote = {
  quoteId: "q1",
  vendorName: "LiquidMesh",
  executionMode: "SWAP" as const,
  fromTokenAmount: usdToRaw(bsc, 10),
  toTokenAmount: BigInt(1000),
  priceImpactPercent: 0.01,
  approveTarget: BINANCE_ROUTER,
  raw: {},
};

const goodSwap = {
  executionMode: "SWAP" as const,
  tx: {
    from: SMART_ACCOUNT,
    to: BINANCE_ROUTER,
    data: "0xdeadbeef" as const,
    value: "0",
    gas: "450000",
    gasPrice: "1",
    minReceiveAmount: BigInt(990),
  },
};

beforeEach(() => {
  quoteSpy.mockReset().mockResolvedValue(goodQuote);
  buildSwapSpy.mockReset().mockResolvedValue(goodSwap);
  vi.mocked(getBinanceWeb3).mockReturnValue({
    quote: quoteSpy,
    buildSwap: buildSwapSpy,
  } as unknown as ReturnType<typeof getBinanceWeb3>);
});

describe("buildBinanceLeg", () => {
  it("rejects an RFQ route before returning anything to sign", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, executionMode: "RFQ" });
    await expect(buildBinanceLeg(args())).rejects.toThrow(/RFQ/);
    expect(buildSwapSpy).not.toHaveBeenCalled();
  });

  it("rejects calldata aimed at any router but the Binance aggregator", async () => {
    buildSwapSpy.mockResolvedValueOnce({
      ...goodSwap,
      tx: { ...goodSwap.tx, to: "0x000000000000000000000000000000000000dEaD" },
    });
    await expect(buildBinanceLeg(args())).rejects.toThrow(/router/);
  });

  it("refuses a leg under the $6 minimum without calling Binance", async () => {
    await expect(buildBinanceLeg(args({ usdValue: 5 }))).rejects.toThrow(/\$6/);
    expect(quoteSpy).not.toHaveBeenCalled();
    expect(buildSwapSpy).not.toHaveBeenCalled();
  });

  it("sets minOut from the slippage budget, never above what Binance guarantees", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, toTokenAmount: BigInt(1000) });
    buildSwapSpy.mockResolvedValueOnce({ ...goodSwap, tx: { ...goodSwap.tx, minReceiveAmount: BigInt(990) } });
    // 1% slippage off 1000 = 990, tied with Binance's own 990 -> the smaller of the two (990).
    const leg = await buildBinanceLeg(args({ slippageBps: 100 }));
    expect(leg.minOut).toBe(BigInt(990));
    expect(leg.router).toBe(BINANCE_ROUTER);
  });

  it("picks Binance's minReceiveAmount when it is tighter than our slippage floor", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, toTokenAmount: BigInt(1000) });
    buildSwapSpy.mockResolvedValueOnce({ ...goodSwap, tx: { ...goodSwap.tx, minReceiveAmount: BigInt(950) } });
    const leg = await buildBinanceLeg(args({ slippageBps: 100 })); // floor would be 990
    expect(leg.minOut).toBe(BigInt(950));
  });

  it("yields a leg when the quote resolves normally (the client's own 429 retry already ran)", async () => {
    // binanceLegs adds no second retry layer (Task 6's web3Request already retries 429/418
    // with backoff) — from here, a call that survived the client's retry just looks like an
    // ordinary successful quote.
    await expect(buildBinanceLeg(args())).resolves.toMatchObject({ router: BINANCE_ROUTER });
  });

  it("propagates a final BinanceWeb3Error with the leg's token named in the message", async () => {
    quoteSpy.mockRejectedValueOnce(new BinanceWeb3Error(429, "rate limited", 429));
    const err = await buildBinanceLeg(args({ symbol: "NVDA" })).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegError);
    expect(err.message).toMatch(/NVDA/);
  });
});

describe("directCallsForLeg", () => {
  const leg: BinanceLeg = {
    router: BINANCE_ROUTER,
    tokenIn: bsc.usdc.address,
    tokenOut: NVDA,
    amountIn: usdToRaw(bsc, 10),
    swapData: "0xdeadbeef",
    minOut: BigInt(990),
    expectedOut: BigInt(1000),
    priceImpactPct: 0.01,
  };

  it("builds an exact-amount approve, then the swap — never a max approval", () => {
    const calls = directCallsForLeg(leg);
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toBe(bsc.usdc.address);
    expect(calls[0].data).toMatch(/^0x095ea7b3/); // approve(address,uint256) selector
    expect(calls[0].data).not.toMatch(/f{64}$/i); // not type(uint256).max
    expect(calls[1]).toEqual({ to: BINANCE_ROUTER, data: leg.swapData });
  });

  it("approves whatever token is going in, so a sell approves the stock, not USDT", () => {
    const sellLeg: BinanceLeg = { ...leg, tokenIn: NVDA, tokenOut: bsc.usdc.address };
    const calls = directCallsForLeg(sellLeg);
    expect(calls[0].to).toBe(NVDA);
  });
});

// checkBscBuyable / bscLegUsdValue back /api/swap-quote's Review Focus #1 gate (409 before any
// Binance call) and the $6-for-a-sell rule. Kept pure and tested directly here rather than by
// standing up the Next.js route (no other route in this codebase is unit-tested — it would mean
// mocking Privy auth, the smart-accounts table and the rate limiter just to reach this logic).
const NOW = Date.parse("2026-09-24T15:00:00.000Z");

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

describe("checkBscBuyable", () => {
  it("is ok when the row is open and trading", () => {
    const gate = checkBscBuyable([row()], NVDA, "NVDA", NOW);
    expect(gate.ok).toBe(true);
  });

  it("refuses, naming the symbol, when the row says the market is paused", () => {
    const gate = checkBscBuyable(
      [row({ statusInfo: { ...row().statusInfo, openState: false, reasonCode: "MARKET_CLOSED" } })],
      NVDA,
      "NVDA",
      NOW,
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toMatch(/^NVDA is closed right now\./);
  });

  it("fails closed when the token isn't in the catalog at all", () => {
    const gate = checkBscBuyable([], NVDA, "NVDA", NOW);
    expect(gate.ok).toBe(false);
  });
});

describe("bscLegUsdValue", () => {
  const asset = assetBySymbol(bsc, "NVDA")!;

  it("prices a buy off the raw cash amount", () => {
    expect(bscLegUsdValue("buy", bsc, usdToRaw(bsc, 12), asset, row())).toBeCloseTo(12, 6);
  });

  it("prices a sell off the token quantity times the catalog's price, not a Binance call", () => {
    // 0.05 tokens at $200/token = $10, using an 18-decimal raw amount.
    const amountIn = BigInt(5) * BigInt(10) ** BigInt(16);
    expect(bscLegUsdValue("sell", bsc, amountIn, asset, row({ tokenPrice: 200 }))).toBeCloseTo(10, 6);
  });
});
