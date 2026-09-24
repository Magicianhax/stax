// Pure-logic tests for the BSC buy gate. AssetDetailScreen's manual buy always resolves the
// asset's own on-chain address (the default venue — bStock where both issuers list a ticker),
// never whichever venue looks best across issuers, so the gate has to agree with that: it must
// consult the venue at that address, not the ticker's summary `bestVenue`. Kept here as a plain
// function so this case is a Node test, not a React Query mock.
import { describe, expect, it } from "vitest";
import { bscBuyGate } from "./useRwa";
import type { RwaTickerView, VenueView } from "@/lib/rwa";

const DEFAULT_ADDR = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as const;
const TWIN_ADDR = "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4" as const;

function venue(over: Partial<VenueView>): VenueView {
  return {
    platform: "bstock",
    symbol: "NVDAB",
    address: DEFAULT_ADDR,
    tokenPrice: 100,
    referencePrice: 100,
    gapPct: 0,
    state: "open",
    buyable: true,
    nextOpenMs: null,
    updatedAt: 0,
    ...over,
  };
}

function ticker(venues: VenueView[], bestVenue: RwaTickerView["bestVenue"]): RwaTickerView {
  return { ticker: "NVDA", name: "Nvidia", type: "stock", venues, bestVenue };
}

describe("bscBuyGate", () => {
  it("reads as checking while the catalog is loading, never as buyable", () => {
    expect(bscBuyGate({ ticker: undefined, address: DEFAULT_ADDR, isLoading: true, isError: false })).toEqual({
      status: "loading",
    });
  });

  it("reads as unavailable on a fetch error (Binance's budget, or the pre-Task-9 404)", () => {
    expect(bscBuyGate({ ticker: undefined, address: DEFAULT_ADDR, isLoading: false, isError: true })).toEqual({
      status: "unavailable",
    });
  });

  it("reads as unavailable when the symbol isn't in the loaded catalog", () => {
    expect(bscBuyGate({ ticker: undefined, address: DEFAULT_ADDR, isLoading: false, isError: false })).toEqual({
      status: "unavailable",
    });
  });

  it("is not buyable when the default venue is paused, even though the twin is buyable and best", () => {
    const t = ticker(
      [venue({ platform: "bstock", address: DEFAULT_ADDR, buyable: false, state: "paused" }), venue({ platform: "ondo", address: TWIN_ADDR, buyable: true })],
      "ondo",
    );
    const gate = bscBuyGate({ ticker: t, address: DEFAULT_ADDR, isLoading: false, isError: false });
    expect(gate).toMatchObject({ status: "ready", buyable: false });
  });

  it("is buyable when the venue at the asset's own address is buyable", () => {
    const t = ticker([venue({ platform: "bstock", address: DEFAULT_ADDR, buyable: true })], "bstock");
    const gate = bscBuyGate({ ticker: t, address: DEFAULT_ADDR, isLoading: false, isError: false });
    expect(gate).toMatchObject({ status: "ready", buyable: true });
  });

  it("address match is case-insensitive (checksum vs. lowercase)", () => {
    const t = ticker([venue({ platform: "bstock", address: DEFAULT_ADDR, buyable: true })], "bstock");
    const gate = bscBuyGate({ ticker: t, address: DEFAULT_ADDR.toUpperCase() as `0x${string}`, isLoading: false, isError: false });
    expect(gate).toMatchObject({ status: "ready", buyable: true });
  });

  it("is unavailable when no venue in the ticker matches the asset's address", () => {
    const t = ticker([venue({ platform: "bstock", address: TWIN_ADDR, buyable: true })], "bstock");
    const gate = bscBuyGate({ ticker: t, address: DEFAULT_ADDR, isLoading: false, isError: false });
    expect(gate).toMatchObject({ status: "ready", buyable: false });
  });
});
