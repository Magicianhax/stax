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
  BinanceLegRefusal,
  bscLegUsdValue,
  buildBinanceLeg,
  checkBscBuyable,
  cryptoLegUsdValue,
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

  it("refuses a leg under the $6 minimum without calling Binance, in plain words with a next step", () => {
    // Design critique P1 #11: "below Binance's $6 minimum" reads like an error the user caused
    // and can't act on; "Enter $6 or more" gives them the actual next step. Reviewer follow-up:
    // side-neutral — buildBinanceLeg prices both buy and sell legs, and "the smallest buy is $6"
    // told someone selling a $5.70 position (bought at the $6 floor, dipped since) that they
    // needed to enter a bigger BUY, on a Sell tab with no amount field at all.
    return expect(buildBinanceLeg(args({ usdValue: 5 }))).rejects.toThrow(/smallest trade is \$6\. Enter \$6 or more/);
  });

  it("refuses a leg under the $6 minimum without calling Binance", async () => {
    await expect(buildBinanceLeg(args({ usdValue: 5 }))).rejects.toThrow(/\$6/);
    expect(quoteSpy).not.toHaveBeenCalled();
    expect(buildSwapSpy).not.toHaveBeenCalled();
  });

  it("gives the same side-neutral $6 message for a sell as for a buy", async () => {
    // The old message read the same regardless of side too, but named "buy" explicitly — this
    // pins that a sell hitting the floor never sees buy-specific wording.
    const err = await buildBinanceLeg(args({ usdValue: 5 })).catch((e) => e);
    expect(err.message).not.toMatch(/buy/i);
    expect(err.message).not.toMatch(/^NVDA:/);
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
    if (!gate.ok) expect(gate.message).toMatch(/^NVDA is closed right now; it opens /);
  });

  // Design critique P0 #1: the message above is server-readable (kept for logs and any caller
  // that only has the string), but the CLIENT must format the reopen time itself — in the
  // viewer's own zone, through marketHours.ts's one shared formatter — so the refusal also
  // carries the raw instant.
  it("carries nextOpenMs on a closed refusal, so the client can format it in the viewer's own zone", () => {
    const gate = checkBscBuyable(
      [row({ statusInfo: { ...row().statusInfo, openState: false, reasonCode: "MARKET_CLOSED" } })],
      NVDA,
      "NVDA",
      NOW,
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(typeof gate.nextOpenMs).toBe("number");
      expect(gate.nextOpenMs).toBeGreaterThan(NOW);
    }
  });

  it("uses the row's own nextOpenTime over the US calendar fallback when Binance gives one", () => {
    const explicit = NOW + 3_600_000;
    const gate = checkBscBuyable(
      [
        row({
          statusInfo: { ...row().statusInfo, openState: false, reasonCode: "MARKET_PAUSED", nextOpenTime: explicit },
        }),
      ],
      NVDA,
      "NVDA",
      NOW,
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.nextOpenMs).toBe(explicit);
  });

  it("refuses a bStock buy on a day the NYSE is shut, even though the issuer's own flags still say TRADING", () => {
    const AFTER_CLOSE = Date.parse("2026-09-26T16:00:00.000Z"); // Saturday noon ET
    const gate = checkBscBuyable(
      [row({ statusInfo: { ...row().statusInfo, marketStatus: null, openState: true, reasonCode: "TRADING" } })],
      NVDA,
      "NVDA",
      AFTER_CLOSE,
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toMatch(/^NVDA is closed right now/);
  });

  it("fails closed when the token isn't in the catalog at all, and says unavailable, not closed", () => {
    const gate = checkBscBuyable([], NVDA, "NVDA", NOW);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.message).toMatch(/isn't available/);
      // No session to report at all — the client falls back to its own "check back" copy.
      expect(gate.nextOpenMs).toBeUndefined();
    }
  });
});

describe("buildBinanceLeg review fixes", () => {
  it("quotes without building the swap for a price check, saving a Binance call", async () => {
    const leg = await buildBinanceLeg(args({ build: false }));
    expect(buildSwapSpy).not.toHaveBeenCalled();
    expect(leg.swapData).toBe("0x");
    expect(leg.expectedOut).toBe(BigInt(1000));
    expect(leg.minOut).toBe(BigInt(990)); // 1000 at 100 bps slippage
  });

  it("refuses an unpriceable (NaN) leg instead of letting it past the $6 floor", async () => {
    await expect(buildBinanceLeg(args({ usdValue: Number.NaN }))).rejects.toBeInstanceOf(BinanceLegRefusal);
    expect(quoteSpy).not.toHaveBeenCalled();
  });

  it("gives an unpriceable leg its own words, never the '$6 minimum' message it never actually failed", async () => {
    // Reviewer follow-up: the NaN case (an unpriced sell) and the $6 floor are different
    // problems — conflating them would tell someone whose position just can't be priced right
    // now that their trade was "too small", which isn't what happened.
    const err = await buildBinanceLeg(args({ usdValue: Number.NaN })).catch((e) => e);
    expect(err.message).not.toMatch(/\$6/);
  });

  it("refuses a quote for a different input amount than requested", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, fromTokenAmount: usdToRaw(bsc, 9) });
    await expect(buildBinanceLeg(args())).rejects.toThrow(/different amount/);
    expect(buildSwapSpy).not.toHaveBeenCalled();
  });

  it("marks RFQ and router rejections as refusals coded 'route', never meant to be shown verbatim", async () => {
    // Design critique P0 #3: "Binance returned an RFQ route" reached the Trade banner. The code
    // lets swap-quote and invest-plan swap it for plain words without string-matching.
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, executionMode: "RFQ" });
    const err = await buildBinanceLeg(args()).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBe("route");
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, approveTarget: "0x000000000000000000000000000000000000dEaD" });
    expect((await buildBinanceLeg(args()).catch((e) => e)).code).toBe("route");
  });

  it("codes the $6 floor 'min_trade' so the client can show it as-is", async () => {
    const err = await buildBinanceLeg(args({ usdValue: 5 })).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBe("min_trade");
  });
});

describe("anchoring the build to the reviewed floor", () => {
  it("builds with slippage tightened so the minimum never drops under what was reviewed", async () => {
    // Fresh quote 1000; the person reviewed 1000 at 1%, floor 990. Price slipped to 996 since.
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, toTokenAmount: BigInt(996) });
    await buildBinanceLeg(args({ slippageBps: 100, reviewedMinOut: BigInt(990) }));
    const percent = Number(buildSwapSpy.mock.calls[0][0].slippagePercent);
    // 996 * (1 - percent/100) must still be >= 990, and tighter than the 1% asked for.
    expect(percent).toBeLessThan(1);
    expect(996 * (1 - percent / 100)).toBeGreaterThanOrEqual(990);
  });

  it("refuses with 'price_moved' when the pool moved past the reviewed floor, building nothing", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, toTokenAmount: BigInt(900) });
    const err = await buildBinanceLeg(args({ slippageBps: 100, reviewedMinOut: BigInt(990) })).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBe("price_moved");
    expect(buildSwapSpy).not.toHaveBeenCalled();
  });

  it("refuses when Binance's built minReceiveAmount is below the reviewed floor", async () => {
    // Reviewed floor 10000; the fresh quote is fine but Binance's calldata would accept 9000.
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, toTokenAmount: BigInt(10_100) });
    buildSwapSpy.mockResolvedValueOnce({ ...goodSwap, tx: { ...goodSwap.tx, minReceiveAmount: BigInt(9000) } });
    const err = await buildBinanceLeg(args({ slippageBps: 100, reviewedMinOut: BigInt(10_000) })).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBe("price_moved");
  });

  it("allows 1 bp of rounding under the reviewed floor", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, toTokenAmount: BigInt(10_100) });
    buildSwapSpy.mockResolvedValueOnce({ ...goodSwap, tx: { ...goodSwap.tx, minReceiveAmount: BigInt(9_999) } });
    await expect(buildBinanceLeg(args({ slippageBps: 100, reviewedMinOut: BigInt(10_000) }))).resolves.toBeDefined();
  });

  it("leaves a price check (no build) alone", async () => {
    // A distinct amount, so the shared 15 s price-check cache can't answer from another test.
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, fromTokenAmount: usdToRaw(bsc, 11), toTokenAmount: BigInt(900) });
    const leg = await buildBinanceLeg(args({ build: false, amountIn: usdToRaw(bsc, 11), usdValue: 11, reviewedMinOut: BigInt(990) }));
    expect(leg.expectedOut).toBe(BigInt(900));
  });
});

describe("the sell floor", () => {
  it("lets a position bought at the $6 minimum (worth about $5.97) be sold", async () => {
    // Binance's own floor is "over $5"; the $6 buffer is for buys only.
    const leg = await buildBinanceLeg(args({ side: "sell", usdValue: 5.97, tokenIn: NVDA, tokenOut: bsc.usdc.address }));
    expect(leg.amountIn).toBe(usdToRaw(bsc, 10));
  });

  it("still refuses a sale at or under $5, with words about selling, not a typed amount", async () => {
    const err = await buildBinanceLeg(args({ side: "sell", usdValue: 4.99 })).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBe("min_trade");
    expect(err.message).not.toMatch(/Enter/);
    expect(quoteSpy).not.toHaveBeenCalled();
  });

  it("keeps the $6 buffer for buys", async () => {
    const err = await buildBinanceLeg(args({ side: "buy", usdValue: 5.97 })).catch((e) => e);
    expect(err.code).toBe("min_trade");
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

describe("cryptoLegUsdValue", () => {
  const btcb = bsc.assets.all.find((a) => a.tier === "crypto")!;

  it("values a crypto buy off the cash amount", () => {
    expect(cryptoLegUsdValue("buy", bsc, usdToRaw(bsc, 7), btcb, undefined)).toBeCloseTo(7, 6);
  });

  it("values a crypto sell at the quoted coin price", () => {
    const amountIn = BigInt(10) ** BigInt(14); // 0.0001 coin
    expect(cryptoLegUsdValue("sell", bsc, amountIn, btcb, 80_000)).toBeCloseTo(8, 6);
  });

  it("is NaN (refused downstream) when a sell has no price", () => {
    expect(cryptoLegUsdValue("sell", bsc, BigInt(1), btcb, undefined)).toBeNaN();
  });
});

describe("shared price checks", () => {
  it("serves a repeat price check for the same pair and amount from one Binance quote", async () => {
    const amountIn = usdToRaw(bsc, 11.37);
    quoteSpy.mockResolvedValue({ ...goodQuote, fromTokenAmount: amountIn });
    const first = await buildBinanceLeg(args({ amountIn, usdValue: 11.37, build: false }));
    const second = await buildBinanceLeg(args({ amountIn, usdValue: 11.37, build: false }));
    expect(quoteSpy).toHaveBeenCalledTimes(1);
    expect(second.expectedOut).toBe(first.expectedOut);
    expect(typeof second.expectedOut).toBe("bigint");
  });

  it("always takes a fresh quote when building the swap to sign", async () => {
    const amountIn = usdToRaw(bsc, 12.41);
    quoteSpy.mockResolvedValue({ ...goodQuote, fromTokenAmount: amountIn });
    await buildBinanceLeg(args({ amountIn, usdValue: 12.41, build: false }));
    await buildBinanceLeg(args({ amountIn, usdValue: 12.41 }));
    expect(quoteSpy).toHaveBeenCalledTimes(2);
  });
});

// 2026-10-09: a $10 NVDA buy reverted RFQ_OrderExpired (tx 0xda37369e…) and a $50 basket failed
// SwapCallFailed(1) in the bundler's simulation. Binance's best route ran through "Rfq …" market
// makers whose signed orders stop filling seconds after the build (Neptunex by 2 s, Halfmoon at
// 16 s). The leg re-routes: pools first, then a route whose only makers are timed (Halfmoon).
describe("market-maker routes", () => {
  const quoteAndSwapSpy = vi.fn();
  const makerQuote = { ...goodQuote, toTokenAmount: BigInt(1000), dexNames: ["Rfq Neptunex"] };
  const reroute = (out: bigint, dexNames = ["Uniswap V4"], minReceiveAmount = (out * BigInt(99)) / BigInt(100)) => ({
    quote: { fromTokenAmount: usdToRaw(bsc, 10), toTokenAmount: out, priceImpactPercent: 0.02, dexNames },
    build: { ...goodSwap, tx: { ...goodSwap.tx, data: "0xd0d0" as const, minReceiveAmount }, dexNames },
  });
  const noRoute = () => new BinanceWeb3Error(40465, "LiquidMesh EVM quoteAndSwap error: Path not found", 200);

  beforeEach(() => {
    quoteAndSwapSpy.mockReset();
    vi.mocked(getBinanceWeb3).mockReturnValue({
      quote: quoteSpy,
      buildSwap: buildSwapSpy,
      quoteAndSwap: quoteAndSwapSpy,
    } as unknown as ReturnType<typeof getBinanceWeb3>);
  });

  it("takes a pool route with every maker excluded before anything else", async () => {
    quoteSpy.mockResolvedValueOnce(makerQuote);
    quoteAndSwapSpy.mockResolvedValueOnce(reroute(BigInt(995)));
    const leg = await buildBinanceLeg(args());
    expect(buildSwapSpy).not.toHaveBeenCalled();
    expect(quoteAndSwapSpy).toHaveBeenCalledTimes(1);
    expect(quoteAndSwapSpy).toHaveBeenCalledWith(
      expect.objectContaining({ excludeDexes: expect.arrayContaining(["Rfq Neptunex", "Rfq Halfmoon", "Rfq Newworld"]), taker: SMART_ACCOUNT }),
    );
    expect(leg.swapData).toBe("0xd0d0");
    expect(leg.expectedOut).toBe(BigInt(995));
    expect(leg.minOut).toBe((BigInt(995) * BigInt(99)) / BigInt(100));
    expect(leg.fillWithinS).toBeUndefined();
  });

  it("falls back to the Halfmoon maker (15 s) when no pool can fill it, and says how long it lasts", async () => {
    quoteSpy.mockResolvedValueOnce(makerQuote);
    quoteAndSwapSpy.mockRejectedValueOnce(noRoute()).mockResolvedValueOnce(reroute(BigInt(998), ["Rfq Halfmoon"]));
    const leg = await buildBinanceLeg(args());
    const timedCall = quoteAndSwapSpy.mock.calls[1][0];
    expect(timedCall.excludeDexes).toContain("Rfq Neptunex");
    expect(timedCall.excludeDexes).not.toContain("Rfq Halfmoon");
    expect(leg.expectedOut).toBe(BigInt(998));
    expect(leg.fillWithinS).toBe(15);
  });

  it("builds Binance's own Halfmoon route through /swap when no pool can fill it (/quote-and-swap never returns one)", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, dexNames: ["Rfq Halfmoon"] });
    buildSwapSpy.mockResolvedValueOnce({ ...goodSwap, dexNames: ["Rfq Halfmoon"] });
    quoteAndSwapSpy.mockRejectedValue(noRoute());
    const leg = await buildBinanceLeg(args());
    expect(quoteAndSwapSpy).toHaveBeenCalledTimes(1); // the pool attempt only
    expect(buildSwapSpy).toHaveBeenCalledWith(expect.objectContaining({ quoteId: "q1" }));
    expect(leg.swapData).toBe("0xdeadbeef");
    expect(leg.fillWithinS).toBe(15);
  });

  it("prices a Halfmoon-only pair on Binance's own route", async () => {
    const amountIn = usdToRaw(bsc, 15.55);
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, fromTokenAmount: amountIn, toTokenAmount: BigInt(777), dexNames: ["Rfq Halfmoon"] });
    quoteAndSwapSpy.mockRejectedValue(noRoute());
    const leg = await buildBinanceLeg(args({ amountIn, usdValue: 15.55, build: false }));
    expect(leg.expectedOut).toBe(BigInt(777));
  });

  it("keeps the ordinary quote-then-swap path when no maker is on the route", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, dexNames: ["Uniswap V4", "Pancakeswap V3"] });
    const leg = await buildBinanceLeg(args());
    expect(quoteAndSwapSpy).not.toHaveBeenCalled();
    expect(leg.swapData).toBe("0xdeadbeef");
  });

  it("re-routes when the built swap itself comes back through a maker, excluding the one it named", async () => {
    quoteSpy.mockResolvedValueOnce({ ...goodQuote, dexNames: ["Uniswap V4"] });
    buildSwapSpy.mockResolvedValueOnce({ ...goodSwap, dexNames: ["Rfq Brandnew"] });
    quoteAndSwapSpy.mockResolvedValueOnce(reroute(BigInt(999)));
    const leg = await buildBinanceLeg(args());
    expect(quoteAndSwapSpy.mock.calls[0][0].excludeDexes).toContain("Rfq Brandnew");
    expect(leg.swapData).toBe("0xd0d0");
  });

  it("refuses 'no_fill', naming the stock, only when neither pools nor a timed maker can fill it", async () => {
    quoteSpy.mockResolvedValueOnce(makerQuote);
    quoteAndSwapSpy.mockRejectedValue(noRoute());
    const err = await buildBinanceLeg(args()).catch((e) => e);
    expect(quoteAndSwapSpy).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBe("no_fill");
    expect(err.message).toMatch(/^Binance has no seller for NVDA/);
  });

  it("never uses a re-route that gives up more than 2% against the maker", async () => {
    quoteSpy.mockResolvedValueOnce(makerQuote);
    quoteAndSwapSpy.mockResolvedValue(reroute(BigInt(979))); // 2.1% under the maker's 1000
    await expect(buildBinanceLeg(args())).rejects.toMatchObject({ code: "no_fill" });
  });

  it("accepts a re-route at exactly 2% under the maker", async () => {
    quoteSpy.mockResolvedValueOnce(makerQuote);
    quoteAndSwapSpy.mockResolvedValueOnce(reroute(BigInt(980)));
    await expect(buildBinanceLeg(args())).resolves.toMatchObject({ expectedOut: BigInt(980) });
  });

  it("never uses a maker with no measured window, even one Binance just added", async () => {
    quoteSpy.mockResolvedValueOnce(makerQuote);
    quoteAndSwapSpy.mockResolvedValue(reroute(BigInt(999), ["Rfq Somethingnew"]));
    await expect(buildBinanceLeg(args())).rejects.toMatchObject({ code: "no_fill" });
  });

  it("passes any other Binance failure through as an upstream error, not a refusal", async () => {
    quoteSpy.mockResolvedValueOnce(makerQuote);
    quoteAndSwapSpy.mockRejectedValueOnce(new BinanceWeb3Error(50000, "server busy", 500));
    await expect(buildBinanceLeg(args())).rejects.toBeInstanceOf(BinanceLegError);
  });

  it("re-anchors the re-route to the reviewed floor before building it", async () => {
    quoteSpy.mockResolvedValueOnce(makerQuote);
    // Reviewed floor 985; the re-route quotes 990, so 1% would drop to 980: tighten and rebuild.
    quoteAndSwapSpy.mockResolvedValueOnce(reroute(BigInt(990))).mockResolvedValueOnce(reroute(BigInt(990), ["Uniswap V4"], BigInt(986)));
    const leg = await buildBinanceLeg(args({ reviewedMinOut: BigInt(985) }));
    expect(quoteAndSwapSpy).toHaveBeenCalledTimes(2);
    const percent = Number(quoteAndSwapSpy.mock.calls[1][0].slippagePercent);
    expect(percent).toBeLessThan(1);
    expect(990 * (1 - percent / 100)).toBeGreaterThanOrEqual(985);
    expect(leg.minOut).toBeGreaterThanOrEqual(BigInt(985));
  });

  it("prices a price check on the route the build will take, building nothing", async () => {
    const amountIn = usdToRaw(bsc, 13.37);
    quoteSpy.mockResolvedValueOnce({ ...makerQuote, fromTokenAmount: amountIn });
    const r = reroute(BigInt(990));
    quoteAndSwapSpy.mockResolvedValueOnce({ ...r, quote: { ...r.quote, fromTokenAmount: amountIn } });
    const leg = await buildBinanceLeg(args({ amountIn, usdValue: 13.37, build: false }));
    expect(leg.expectedOut).toBe(BigInt(990));
    expect(leg.swapData).toBe("0x");
    expect(buildSwapSpy).not.toHaveBeenCalled();
  });

  it("remembers a no-fill price check for the next poll instead of asking Binance again", async () => {
    const amountIn = usdToRaw(bsc, 14.21);
    quoteSpy.mockResolvedValueOnce({ ...makerQuote, fromTokenAmount: amountIn });
    quoteAndSwapSpy.mockRejectedValue(noRoute());
    await expect(buildBinanceLeg(args({ amountIn, usdValue: 14.21, build: false }))).rejects.toMatchObject({ code: "no_fill" });
    await expect(buildBinanceLeg(args({ amountIn, usdValue: 14.21, build: false }))).rejects.toMatchObject({ code: "no_fill" });
    expect(quoteSpy).toHaveBeenCalledTimes(1);
    expect(quoteAndSwapSpy).toHaveBeenCalledTimes(2);
  });
});
