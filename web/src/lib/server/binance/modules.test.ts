// Each wrapper is a thin, typed call to web3Request. These pin the wire shape from
// docs/BINANCE-WEB3.md against fixtures recorded from live Binance Web3 calls (candles_response
// is the one exception: no live capture was saved for that endpoint during research, so it is
// built to the tuple shape §3 documents, and that gap is called out in this task's report).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({ web3Request: vi.fn() }));

import { web3Request } from "./client";
import rwaTokensFixture from "./__fixtures__/rwa_tokens.json";
import quoteFixture from "./__fixtures__/quote_response.json";
import swapFixture from "./__fixtures__/swap_response.json";
import simulateFixture from "./__fixtures__/simulate_response.json";
import balancesFixture from "./__fixtures__/balances_response.json";
import candlesFixture from "./__fixtures__/candles_response.json";

const mockWeb3Request = vi.mocked(web3Request);

const BINANCE_ROUTER = "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5";

beforeEach(() => {
  mockWeb3Request.mockReset();
});

describe("rwaTokens", () => {
  it("returns typed rows with statusInfo", async () => {
    mockWeb3Request.mockResolvedValueOnce(rwaTokensFixture);
    const { rwaTokens } = await import("./rwa");
    const rows = await rwaTokens();
    expect(rows).toHaveLength(12);
    const nvdaOndo = rows.find((r) => r.underlyingTicker === "NVDA" && r.platformId === "ondo");
    expect(nvdaOndo?.statusInfo).toEqual({
      openState: true,
      marketStatus: "premarket",
      reasonCode: "TRADING",
      reasonMsg: null,
      nextOpenTime: 1790256660000,
      nextCloseTime: 1790256540000,
    });
    expect(typeof nvdaOndo?.tokenPrice).toBe("number");
    expect(typeof nvdaOndo?.decimals).toBe("number");
    const paused = rows.find((r) => r.statusInfo.reasonCode === "MARKET_PAUSED");
    expect(paused?.statusInfo.openState).toBe(false);
    const unsupported = rows.find((r) => r.statusInfo.reasonCode === "UNSUPPORTED");
    expect(unsupported).toBeDefined();
  });
});

describe("rwaPrices", () => {
  it("rejects more than 100 addresses before calling the API", async () => {
    const { rwaPrices } = await import("./rwa");
    const addrs = Array.from({ length: 101 }, (_, i) => `0x${i.toString().padStart(40, "0")}` as `0x${string}`);
    await expect(rwaPrices(addrs)).rejects.toThrow(/100/);
    expect(mockWeb3Request).not.toHaveBeenCalled();
  });

  it("parses prices into numbers", async () => {
    mockWeb3Request.mockResolvedValueOnce([
      {
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        platformId: "ondo",
        tokenPrice: "224.116858750386461291676129159936",
        referencePrice: "223.73310081858432",
        tokenPriceUpdatedAt: 1790252870000,
      },
    ]);
    const { rwaPrices } = await import("./rwa");
    const prices = await rwaPrices(["0xa9ee28c80f960b889dfbd1902055218cba016f75"]);
    expect(prices[0].tokenPrice).toBeCloseTo(224.1168, 3);
    expect(prices[0].referencePrice).toBeCloseTo(223.7331, 3);
  });
});

describe("candles", () => {
  it("parses the [o,h,l,c,v,tMs,n] tuple into Candle", async () => {
    mockWeb3Request.mockResolvedValueOnce(candlesFixture);
    const { candles } = await import("./market");
    const rows = await candles("0xa9ee28c80f960b889dfbd1902055218cba016f75", "1h", 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ open: 223.1, high: 223.9, low: 222.8, close: 223.54, volume: 184032.5, t: 1790247600000, trades: 412 });
  });
});

describe("quote", () => {
  it("returns bigint amounts and executionMode, and always sends userWalletAddress", async () => {
    mockWeb3Request.mockResolvedValueOnce(quoteFixture);
    const { quote } = await import("./trading");
    const taker = "0xd2a27f8fdbaaec431d59046a8bce4e5db665a271" as const;
    const result = await quote({
      fromToken: "0x55d398326f99059fF775485246999027B3197955",
      toToken: "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4",
      amount: BigInt("6000000000000000000"),
      taker,
    });
    expect(result.executionMode).toBe("SWAP");
    expect(typeof result.fromTokenAmount).toBe("bigint");
    expect(result.fromTokenAmount).toBe(BigInt("6000000000000000000"));
    expect(result.toTokenAmount).toBe(BigInt("17746966277828301"));
    expect(result.approveTarget).toBe(BINANCE_ROUTER);
    const [, , query] = mockWeb3Request.mock.calls[0];
    expect(query).toMatchObject({ userWalletAddress: taker });
  });
});

describe("buildSwap", () => {
  it("returns tx.to equal to the router", async () => {
    mockWeb3Request.mockResolvedValueOnce(swapFixture);
    const { buildSwap } = await import("./trading");
    const result = await buildSwap({
      fromToken: "0x55d398326f99059fF775485246999027B3197955",
      toToken: "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4",
      amount: BigInt("6000000000000000000"),
      taker: "0xd2a27f8fdbaaec431d59046a8bce4e5db665a271",
      quoteId: "c532edf4d1904ae5b3385b5bb6d2b8af",
      slippagePercent: "1",
    });
    expect(result.tx.to.toLowerCase()).toBe(BINANCE_ROUTER.toLowerCase());
    expect(typeof result.tx.minReceiveAmount).toBe("bigint");
  });
});

describe("simulate", () => {
  it("returns balanceChanges", async () => {
    mockWeb3Request.mockResolvedValueOnce(simulateFixture);
    const { simulate } = await import("./transaction");
    const result = await simulate({
      from: "0x1111111111111111111111111111111111111111",
      to: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      value: "0",
      data: "0x095ea7b3",
    });
    expect(result.status).toBe("SUCCESS");
    expect(Array.isArray(result.balanceChanges)).toBe(true);
  });
});

describe("balances", () => {
  it("rejects more than 20 tokens before calling the API", async () => {
    const { balances } = await import("./wallet");
    const tokens = Array.from({ length: 21 }, (_, i) => `0x${i.toString().padStart(40, "0")}` as `0x${string}`);
    await expect(balances("0x10ED43C718714eb63d5aA57B78B54704E256024E", tokens)).rejects.toThrow(/20/);
    expect(mockWeb3Request).not.toHaveBeenCalled();
  });

  it("parses balances, with rawBalance as bigint", async () => {
    mockWeb3Request.mockResolvedValueOnce(balancesFixture);
    const { balances } = await import("./wallet");
    const result = await balances("0x10ED43C718714eb63d5aA57B78B54704E256024E", [
      "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("WBNB");
    expect(typeof result[0].rawBalance).toBe("bigint");
  });
});

describe("getBinanceWeb3", () => {
  it("wires up every module", async () => {
    const { getBinanceWeb3 } = await import("./index");
    const client = getBinanceWeb3();
    for (const fn of ["rwaTokens", "rwaPrices", "rwaSearch", "rwaProfile", "candles", "quote", "buildSwap", "simulate", "balances"] as const) {
      expect(typeof client[fn]).toBe("function");
    }
  });
});
