// buildLegs on BNB Chain once the executor is live: every Vera plan, basket and Autopilot run
// on BSC builds its StaxExecutor legs here. Each stock leg must buy the issuer the plan showed
// (bStock or Ondo — the executor whitelists both), re-checked buyable against Binance's cached
// RWA token list right before any quote, and a closed or paused leg stops the whole plan with
// the direct path's own refusal. Crypto (BTCB/ETH/BNB) has no market hours and skips that gate.
// Binance and the catalog are mocked; nothing here reaches the network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";

vi.mock("server-only", () => ({}));
vi.mock("./server/binance", () => ({ getBinanceWeb3: vi.fn() }));
const loadBscMarketSpy = vi.fn();
vi.mock("./server/bscMarket", () => ({ loadBscMarket: (...args: unknown[]) => loadBscMarketSpy(...args) }));

import { getBinanceWeb3 } from "./server/binance";
import { buildLegs } from "./legBuilder";
import { assetBySymbol, getChain } from "./chains";
import { usdToRaw } from "./units";
import { BinanceLegRefusal } from "./server/binanceLegs";
import type { StaxChain } from "./chains/types";
import type { Allocation } from "./allocation-schema";
import type { RwaTickerView, VenueView } from "./rwa";
import type { RwaToken } from "./server/binance/types";

const base = getChain("bsc");
const bsc: StaxChain = { ...base, contracts: { ...base.contracts, deployed: true } };
const undeployed: StaxChain = { ...base, contracts: { ...base.contracts, deployed: false } };
const nvda = assetBySymbol(bsc, "NVDA")!;
const btcb = assetBySymbol(bsc, "BTCB")!;
const NVDA_B = nvda.address!;
const NVDA_ONDO = nvda.twin!.address;
const NOW = Date.parse("2026-09-24T15:00:00.000Z"); // Thursday, US market open
const NOW_S = Math.floor(NOW / 1000);
const ROUTER = bsc.routers.binance!;
const EXECUTOR = bsc.contracts.executor;
const noClient = {} as PublicClient; // the Binance branch never reads pools

function venue(overrides: Partial<VenueView> = {}): VenueView {
  return { platform: "bstock", symbol: "NVDAB", address: NVDA_B, tokenPrice: 200, referencePrice: 200, gapPct: 0, state: "open", buyable: true, nextOpenMs: null, updatedAt: NOW, ...overrides };
}
const nvdaTicker = (bestVenue: "bstock" | "ondo" | null = "bstock"): RwaTickerView => ({
  ticker: "NVDA",
  name: "Nvidia",
  type: "stock",
  venues: [venue(), venue({ platform: "ondo", symbol: "NVDAon", address: NVDA_ONDO, gapPct: 0.4 })],
  bestVenue,
});
function row(address: `0x${string}`, open = true): RwaToken {
  return {
    binanceChainId: "56", tokenContractAddress: address, platformId: "bstock", assetType: 1, tokenName: "Nvidia", tokenSymbol: "NVDA",
    tokenLogoUrl: "", decimals: 18, underlyingTicker: "NVDA", underlyingName: "Nvidia", tokenToShareRatio: 1,
    statusInfo: { openState: open, marketStatus: open ? "regular" : "closed", reasonCode: open ? "TRADING" : "MARKET_CLOSED", reasonMsg: null, nextOpenTime: open ? null : NOW + 3_600_000, nextCloseTime: null },
    tokenPrice: 200, referencePrice: 200, volume24H: 0, marketCap: 0,
  } as RwaToken;
}

const quoteSpy = vi.fn();
const buildSwapSpy = vi.fn();
beforeEach(() => {
  quoteSpy.mockReset().mockImplementation(async (p: { amount: bigint }) => ({
    quoteId: "q1", vendorName: "LiquidMesh", executionMode: "SWAP", fromTokenAmount: p.amount, toTokenAmount: BigInt(1000),
    priceImpactPercent: 0.01, approveTarget: ROUTER, raw: {},
  }));
  buildSwapSpy.mockReset().mockResolvedValue({
    executionMode: "SWAP",
    tx: { from: EXECUTOR, to: ROUTER, data: "0xdeadbeef", value: "0", gas: "450000", gasPrice: "1", minReceiveAmount: BigInt(990) },
  });
  vi.mocked(getBinanceWeb3).mockReturnValue({ quote: quoteSpy, buildSwap: buildSwapSpy } as unknown as ReturnType<typeof getBinanceWeb3>);
  loadBscMarketSpy.mockReset();
});

const alloc = (allocations: Allocation["allocations"]): Allocation => ({ summary: "s", rationale: "r", riskScore: 6000, allocations });
const market = (tokens: RwaToken[] = [row(NVDA_B), row(NVDA_ONDO)], catalog: RwaTickerView[] = [nvdaTicker()]) => ({ catalog, tokens, nowMs: NOW });

describe("buildLegs on BSC with the executor live: issuer-aware legs", () => {
  it("buys the Ondo token when the plan showed Ondo, quoted with the executor as taker", async () => {
    const { legs } = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why", venue: "ondo", address: NVDA_ONDO }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market(),
    });
    expect(legs).toHaveLength(1);
    expect(legs[0].tokenOut).toBe(NVDA_ONDO);
    expect(legs[0].router).toBe(ROUTER);
    expect(quoteSpy).toHaveBeenCalledWith(expect.objectContaining({ toToken: NVDA_ONDO, taker: EXECUTOR }));
    expect(buildSwapSpy).toHaveBeenCalledWith(expect.objectContaining({ toToken: NVDA_ONDO, taker: EXECUTOR }));
  });

  it("buys the catalog's best issuer when the entry names none (a basket)", async () => {
    const { legs } = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why" }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market(undefined, [nvdaTicker("ondo")]),
    });
    expect(legs[0].tokenOut).toBe(NVDA_ONDO);
  });

  it("switches to the open issuer when the planned one stopped trading", async () => {
    const { legs } = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why", venue: "ondo" }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market([row(NVDA_B), row(NVDA_ONDO, false)]),
    });
    expect(legs[0].tokenOut).toBe(NVDA_B);
  });

  it("fails the whole plan with the direct path's closed refusal, before any Binance call, when a stock leg can't be bought", async () => {
    const err = await buildLegs({
      chain: bsc,
      allocation: alloc([
        { symbol: "BTCB", weightPct: 50, reason: "why" },
        { symbol: "NVDA", weightPct: 50, reason: "why" },
      ]),
      usdcTotal: usdToRaw(bsc, 20),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market([row(NVDA_B, false), row(NVDA_ONDO, false)], [nvdaTicker(null)]),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBeUndefined();
    expect(err.message).toMatch(/^NVDA is closed right now/);
    expect(quoteSpy).not.toHaveBeenCalled(); // nothing partial: no leg was quoted or built
  });

  it("builds a crypto leg off the coin's own address with no catalog row and no market-hours gate", async () => {
    const { legs } = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "BTCB", weightPct: 100, reason: "why" }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: { catalog: [], tokens: [], nowMs: NOW },
    });
    expect(legs[0].tokenOut).toBe(btcb.address);
  });

  it("loads the catalog and token list itself when the caller passes none (Autopilot), and only for stock legs", async () => {
    loadBscMarketSpy.mockResolvedValue(market());
    await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why", venue: "ondo" }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
    });
    expect(loadBscMarketSpy).toHaveBeenCalledTimes(1);
    expect(loadBscMarketSpy).toHaveBeenCalledWith(NOW);

    loadBscMarketSpy.mockClear();
    await buildLegs({ chain: bsc, allocation: alloc([{ symbol: "BTCB", weightPct: 100, reason: "why" }]), usdcTotal: usdToRaw(bsc, 10), client: noClient, nowSeconds: NOW_S });
    expect(loadBscMarketSpy).not.toHaveBeenCalled();
  });

  it("refuses a leg under $6 with the min_trade code (invest-plan's plan-worded message)", async () => {
    const err = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why" }]),
      usdcTotal: usdToRaw(bsc, 5),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBe("min_trade");
  });

  it("still drops every BSC leg, never touching Binance, on a chain whose executor isn't deployed", async () => {
    await expect(
      buildLegs({
        chain: undeployed,
        allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why" }]),
        usdcTotal: usdToRaw(undeployed, 10),
        client: noClient,
        nowSeconds: NOW_S,
      }),
    ).rejects.toThrow(/No investable assets/);
    expect(loadBscMarketSpy).not.toHaveBeenCalled();
    expect(quoteSpy).not.toHaveBeenCalled();
  });
});

// A Vera plan or basket leg whose issuer only a short-lived maker can fill ("no_fill") buys the
// same share from the other issuer, the same switch resolveBscStockToken makes for a closed one.
// An Autopilot rule (strictVenue) chose its issuer on purpose and refuses instead.
describe("buildLegs on BSC: an issuer Binance can't fill", () => {
  const noFillFor = (token: `0x${string}`) => async (p: { toToken: `0x${string}` }) => {
    if (p.toToken.toLowerCase() === token.toLowerCase()) {
      throw new BinanceLegRefusal("Binance can't fill NVDA right now.", "no_fill");
    }
    return { executionMode: "SWAP", tx: { from: EXECUTOR, to: ROUTER, data: "0xbeef", value: "0", gas: "1", gasPrice: "1", minReceiveAmount: BigInt(990) } };
  };

  it("buys the other issuer when the planned one can only be filled by a maker", async () => {
    buildSwapSpy.mockImplementation(noFillFor(NVDA_ONDO));
    const { legs, notes } = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why", venue: "ondo" }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market(),
    });
    expect(legs[0].tokenOut).toBe(NVDA_B);
    expect(notes.join(" ")).toMatch(/NVDA: bought from the other issuer/);
  });

  it("refuses with 'no_fill' when neither issuer can be filled", async () => {
    buildSwapSpy.mockImplementation(async () => {
      throw new BinanceLegRefusal("Binance can't fill NVDA right now.", "no_fill");
    });
    const err = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why" }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect(err.code).toBe("no_fill");
  });

  it("never switches to an issuer that is closed", async () => {
    buildSwapSpy.mockImplementation(noFillFor(NVDA_ONDO));
    const err = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why", venue: "ondo" }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market([row(NVDA_B, false), row(NVDA_ONDO)]),
    }).catch((e) => e);
    expect(err.code).toBe("no_fill");
  });

  it("keeps an Autopilot rule's issuer and refuses rather than switch", async () => {
    buildSwapSpy.mockImplementation(noFillFor(NVDA_ONDO));
    const err = await buildLegs({
      chain: bsc,
      allocation: alloc([{ symbol: "NVDA", weightPct: 100, reason: "why", venue: "ondo" }]),
      usdcTotal: usdToRaw(bsc, 10),
      client: noClient,
      nowSeconds: NOW_S,
      bscMarket: market(),
      strictVenue: true,
    }).catch((e) => e);
    expect(err.code).toBe("no_fill");
    expect(buildSwapSpy).toHaveBeenCalledTimes(1);
  });
});
