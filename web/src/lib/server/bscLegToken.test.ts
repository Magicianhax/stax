// resolveBscStockToken is the one rule both Vera's executor legs (lib/legBuilder.ts) and
// Autopilot's rule legs use to decide which issuer's token a BSC stock leg buys: the issuer the
// plan screen showed (`venue`, then `address`), else the catalog's current best, else the asset's
// own default — and whichever it lands on must pass checkBscBuyable against the cached rwaTokens
// right now, or the whole plan is refused with the same words the direct path uses.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./binance", () => ({ getBinanceWeb3: vi.fn() }));

import { assetBySymbol, getChain } from "@/lib/chains";
import type { RwaTickerView, VenueView } from "@/lib/rwa";
import type { RwaToken } from "./binance/types";
import { BinanceLegRefusal } from "./binanceLegs";
import { resolveBscStockToken } from "./bscLegToken";

const bsc = getChain("bsc");
const nvda = assetBySymbol(bsc, "NVDA")!;
const NVDA_B = nvda.address!;
const NVDA_ONDO = nvda.twin!.address;
const NOW = Date.parse("2026-09-24T15:00:00.000Z"); // a Thursday, US market open

function venue(overrides: Partial<VenueView> = {}): VenueView {
  return {
    platform: "bstock",
    symbol: "NVDAB",
    address: NVDA_B,
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

const both: RwaTickerView = {
  ticker: "NVDA",
  name: "Nvidia",
  type: "stock",
  venues: [venue(), venue({ platform: "ondo", symbol: "NVDAon", address: NVDA_ONDO, gapPct: 0.4 })],
  bestVenue: "bstock",
};

function row(address: `0x${string}`, open = true): RwaToken {
  return {
    binanceChainId: "56",
    tokenContractAddress: address,
    platformId: "bstock",
    assetType: 1,
    tokenName: "Nvidia",
    tokenSymbol: "NVDA",
    tokenLogoUrl: "",
    decimals: 18,
    underlyingTicker: "NVDA",
    underlyingName: "Nvidia",
    tokenToShareRatio: 1,
    statusInfo: {
      openState: open,
      marketStatus: open ? "regular" : "closed",
      reasonCode: open ? "TRADING" : "MARKET_CLOSED",
      reasonMsg: null,
      nextOpenTime: open ? null : NOW + 3_600_000,
      nextCloseTime: null,
    },
    tokenPrice: 200,
    referencePrice: 200,
    volume24H: 0,
    marketCap: 0,
  } as RwaToken;
}

const bothOpen = [row(NVDA_B), row(NVDA_ONDO)];
const resolve = (planned: { venue?: "bstock" | "ondo"; address?: string }, tokens = bothOpen, ticker: RwaTickerView | undefined = both) =>
  resolveBscStockToken({ chain: bsc, asset: nvda, planned, ticker, tokens, nowMs: NOW });

describe("resolveBscStockToken", () => {
  it("buys the issuer the plan showed (its venue), even when the catalog's best is the other one", () => {
    expect(resolve({ venue: "ondo" })).toBe(NVDA_ONDO);
  });

  it("reads the plan's address when it carries no venue, but only if it is this asset's own token", () => {
    expect(resolve({ address: NVDA_ONDO })).toBe(NVDA_ONDO);
    expect(resolve({ address: "0x000000000000000000000000000000000000dEaD" })).toBe(NVDA_B);
  });

  it("lets the venue win over a disagreeing address (the screen shows the venue)", () => {
    expect(resolve({ venue: "ondo", address: NVDA_B })).toBe(NVDA_ONDO);
  });

  it("falls back to the catalog's best issuer when the plan named none", () => {
    const ondoBest = { ...both, bestVenue: "ondo" as const };
    expect(resolve({}, bothOpen, ondoBest)).toBe(NVDA_ONDO);
  });

  it("falls back to the best issuer when the planned one stopped trading (same as the direct path)", () => {
    expect(resolve({ venue: "ondo" }, [row(NVDA_B), row(NVDA_ONDO, false)])).toBe(NVDA_B);
  });

  it("falls back to the asset's own default when the catalog has no row for the ticker", () => {
    expect(resolve({}, bothOpen, undefined)).toBe(NVDA_B);
  });

  it("refuses, with the direct path's closed wording, when the resolved issuer isn't buyable right now", () => {
    let err: unknown;
    try {
      resolve({}, [row(NVDA_B, false), row(NVDA_ONDO, false)], { ...both, bestVenue: null });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BinanceLegRefusal);
    expect((err as BinanceLegRefusal).code).toBeUndefined();
    expect((err as Error).message).toMatch(/^NVDA is closed right now/);
  });

  it("refuses (fails closed) when the cached tokens list doesn't carry the resolved address at all", () => {
    expect(() => resolve({}, [row(NVDA_ONDO)])).toThrow(/NVDA isn't available to trade on BNB Chain right now/);
  });
});
