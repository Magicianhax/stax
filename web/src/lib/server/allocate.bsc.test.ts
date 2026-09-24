// buildAllocation on BSC (Task 12): Vera's candidate universe is the catalog filtered to
// what's buyable right now, not just "listed" — and the $6-per-leg floor (Global Constraint,
// Review Focus #3) is enforced both before the model is asked and again on what it returns.
// The model itself is mocked throughout (`ai`'s generateObject); nothing here makes a live
// Anthropic or Binance call. Base is checked too, to pin that none of this touches a chain
// that isn't BSC.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateObjectSpy = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObjectSpy(...args) }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "mock-model" }));

const bscCatalogSnapshotSpy = vi.fn();
vi.mock("./rwaCatalog", () => ({ bscCatalogSnapshot: (...args: unknown[]) => bscCatalogSnapshotSpy(...args) }));

import { buildAllocation } from "./allocate";
import { AllocationRefusal } from "./bscPlan";
import { getChain } from "@/lib/chains";
import type { RwaTickerView, VenueView } from "@/lib/rwa";

const bsc = getChain("bsc");
const NOW = Date.parse("2026-09-24T15:00:00.000Z");

function venue(overrides: Partial<VenueView> = {}): VenueView {
  return {
    platform: "bstock",
    symbol: "NVDAB",
    address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
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

function objectResult(allocations: { symbol: string; weightPct: number; reason: string }[]) {
  return {
    object: {
      summary: "s",
      rationale: "r",
      riskScore: 6000,
      allocations,
    },
  };
}

beforeEach(() => {
  generateObjectSpy.mockReset();
  bscCatalogSnapshotSpy.mockReset();
});

describe("buildAllocation on BSC", () => {
  it("filters the model's universe to tickers buyable right now, and explains the rest", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({
      asOf: NOW,
      tickers: [
        ticker({ ticker: "NVDA", bestVenue: "bstock" }),
        ticker({
          ticker: "TSLA",
          name: "Tesla",
          bestVenue: null,
          venues: [venue({ symbol: "TSLAB", buyable: false, state: "closed", nextOpenMs: NOW + 3600_000 })],
        }),
      ],
    });
    generateObjectSpy.mockResolvedValue(objectResult([{ symbol: "NVDA", weightPct: 100, reason: "why" }]));

    await buildAllocation(bsc, "grow it", 100);

    expect(generateObjectSpy).toHaveBeenCalledTimes(1);
    const { system } = generateObjectSpy.mock.calls[0][0] as { system: string };
    expect(system).toMatch(/Allocate ONLY across these available assets.*NVDA/);
    expect(system).not.toMatch(/available assets on BNB Chain:.*TSLA/);
    expect(system).toMatch(/must never be picked/);
    expect(system).toMatch(/TSLA/);
  });

  it("refuses before ever calling the model when nothing in the catalog is buyable", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({
      asOf: NOW,
      tickers: [
        ticker({ ticker: "NVDA", bestVenue: null, venues: [venue({ buyable: false, nextOpenMs: NOW + 3600_000 })] }),
      ],
    });

    await expect(buildAllocation(bsc, "grow it", 100)).rejects.toThrow(/closed/i);
    // Typed, not a plain Error, so /api/allocate can map it to a 4xx instead of a
    // generic 500 (Review Focus #1) — see the "problems" this fixed for the wording.
    await expect(buildAllocation(bsc, "grow it", 100)).rejects.toBeInstanceOf(AllocationRefusal);
    expect(generateObjectSpy).not.toHaveBeenCalled();
  });

  it("refuses before calling the model when the amount can't fund even one $6 leg", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW, tickers: [ticker()] });

    await expect(buildAllocation(bsc, "grow it", 5)).rejects.toThrow(/\$6/);
    await expect(buildAllocation(bsc, "grow it", 5)).rejects.toBeInstanceOf(AllocationRefusal);
    expect(generateObjectSpy).not.toHaveBeenCalled();
  });

  it("caps a model plan with too many legs down to floor(usd/6) and renormalises", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({
      asOf: NOW,
      tickers: [
        ticker({ ticker: "NVDA" }),
        ticker({ ticker: "MSFT", name: "Microsoft", venues: [venue({ address: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0", symbol: "MSFTB" })] }),
        ticker({ ticker: "TSLA", name: "Tesla", venues: [venue({ address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", symbol: "TSLAB" })] }),
        ticker({ ticker: "META", name: "Meta", venues: [venue({ address: "0x7425889fe94f9d693e8daefe88bcced6acfef4c0", symbol: "METAB" })] }),
        ticker({ ticker: "GOOGL", name: "Google", venues: [venue({ address: "0x3f53de71c126bdabae20f9cd64848d317f6c3238", symbol: "GOOGLB" })] }),
      ],
    });
    // $20 -> floor(20/6) = 3 legs; the model (equal-weighted) asked for 5.
    generateObjectSpy.mockResolvedValue(
      objectResult(["NVDA", "MSFT", "TSLA", "META", "GOOGL"].map((symbol) => ({ symbol, weightPct: 20, reason: "why" }))),
    );

    const result = await buildAllocation(bsc, "spread it out", 20);
    expect(result.allocations).toHaveLength(3);
    const total = result.allocations.reduce((s, a) => s + a.weightPct, 0);
    expect(total).toBeCloseTo(100, 1);
    for (const a of result.allocations) {
      expect((a.weightPct / 100) * 20).toBeGreaterThanOrEqual(6);
    }
  });

  it("shrinks a heavily skewed model plan to the legs that clear $6, instead of refusing outright", async () => {
    // 97/3 at $20 leaves MSFT at $0.60 even after the count-cap renormalisation; a valid
    // 1-leg plan (NVDA at the full $20) exists, so that's what comes back (Review Focus #3).
    bscCatalogSnapshotSpy.mockResolvedValue({
      asOf: NOW,
      tickers: [
        ticker({ ticker: "NVDA" }),
        ticker({ ticker: "MSFT", name: "Microsoft", venues: [venue({ address: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0", symbol: "MSFTB" })] }),
      ],
    });
    generateObjectSpy.mockResolvedValue(
      objectResult([
        { symbol: "NVDA", weightPct: 97, reason: "why" },
        { symbol: "MSFT", weightPct: 3, reason: "why" },
      ]),
    );

    const result = await buildAllocation(bsc, "grow it", 20);
    expect(result.allocations).toEqual([expect.objectContaining({ symbol: "NVDA", weightPct: 100 })]);
  });

  it("stamps each surviving leg with the venue and address the catalog currently picks", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({
      asOf: NOW,
      tickers: [
        ticker({
          ticker: "NVDA",
          venues: [
            venue({ platform: "bstock", address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", gapPct: 2 }),
            venue({ platform: "ondo", address: "0xa9ee28c80f960b889dfbd1902055218cba016f75", gapPct: 0.1 }),
          ],
          bestVenue: "ondo", // the smaller gap
        }),
      ],
    });
    generateObjectSpy.mockResolvedValue(objectResult([{ symbol: "NVDA", weightPct: 100, reason: "why" }]));

    const result = await buildAllocation(bsc, "grow it", 100);
    expect(result.allocations[0]).toMatchObject({
      symbol: "NVDA",
      venue: "ondo",
      address: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
    });
  });
});

describe("buildAllocation on BSC: crypto mix (Wave 5 direction A/B)", () => {
  function oneNvdaCatalog() {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW, tickers: [ticker({ ticker: "NVDA", bestVenue: "bstock" })] });
  }

  it("leaves crypto out of the universe and the prompt when the goal never mentions it", async () => {
    oneNvdaCatalog();
    generateObjectSpy.mockResolvedValue(objectResult([{ symbol: "NVDA", weightPct: 100, reason: "why" }]));

    await buildAllocation(bsc, "grow my savings", 100);

    const { system } = generateObjectSpy.mock.calls[0][0] as { system: string };
    expect(system).not.toMatch(/BTCB/);
  });

  it("adds crypto to the universe and the prompt when the goal asks for a mix", async () => {
    oneNvdaCatalog();
    generateObjectSpy.mockResolvedValue(
      objectResult([
        { symbol: "NVDA", weightPct: 80, reason: "why" },
        { symbol: "BTCB", weightPct: 20, reason: "why" },
      ]),
    );

    await buildAllocation(bsc, "80% stocks, 20% crypto", 100);

    const { system } = generateObjectSpy.mock.calls[0][0] as { system: string };
    expect(system).toMatch(/BTCB/);
    expect(system).toMatch(/20%/);
  });

  it("renormalises onto the requested ratio when the model's own picks miss it, and stamps a real BSC address on the crypto leg", async () => {
    oneNvdaCatalog();
    // The model ignores the ratio rule entirely (a real model can misbehave) and returns
    // 100% stock; the pure post-check still gets the user close to what they asked for.
    generateObjectSpy.mockResolvedValue(objectResult([{ symbol: "NVDA", weightPct: 100, reason: "why" }]));

    const result = await buildAllocation(bsc, "80% stocks, 20% crypto", 100);

    const crypto = result.allocations.find((a) => a.symbol === "BTCB");
    const nvda = result.allocations.find((a) => a.symbol === "NVDA");
    expect(crypto).toBeDefined();
    expect(crypto!.weightPct).toBeCloseTo(20, 0);
    expect(nvda!.weightPct).toBeCloseTo(80, 0);
    // Crypto isn't in the RWA catalog, so its address must come from the chain's own asset
    // registry, not the (empty, for BTCB) catalog venue lookup.
    expect(crypto!.address?.toLowerCase()).toBe("0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c");
    expect(crypto).not.toHaveProperty("venue"); // no issuer choice for a plain crypto asset
  });

  it("still clears the $6 floor after a ratio correction shrinks a leg", async () => {
    oneNvdaCatalog();
    generateObjectSpy.mockResolvedValue(objectResult([{ symbol: "NVDA", weightPct: 100, reason: "why" }]));

    // At $20, a strict 80/20 split would put BTCB at $4 (under the floor); the plan must still
    // come back with every leg clearing $6, even if that means the ratio drifts from the ask.
    const result = await buildAllocation(bsc, "80% stocks, 20% crypto", 20);

    for (const a of result.allocations) {
      expect((a.weightPct / 100) * 20).toBeGreaterThanOrEqual(6 - 1e-6);
    }
  });
});

describe("buildAllocation on Base", () => {
  it("never touches the BSC catalog, and never stamps a venue/address", async () => {
    generateObjectSpy.mockResolvedValue(objectResult([{ symbol: "NVDA", weightPct: 100, reason: "why" }]));

    const result = await buildAllocation(getChain("base"), "grow it", 100);

    expect(bscCatalogSnapshotSpy).not.toHaveBeenCalled();
    expect(result.allocations[0]).not.toHaveProperty("venue");
    expect(result.allocations[0]).not.toHaveProperty("address");
  });
});
