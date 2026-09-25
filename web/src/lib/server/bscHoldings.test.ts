// getBscHoldings: the live, tier-tagged, per-symbol USD holdings the rule engine's
// rebalance/safety_switch/mix_keeper rules need (rulesEngine.ts's RuleRunContext.holdings).
// Reuses the exact same merged balance read /api/portfolio uses (bscBalances.ts) and prices each
// position the same way the app already prices it elsewhere (the RWA catalog's per-venue
// tokenPrice for stocks, lib/prices.ts's quote price for crypto) — never a fabricated number.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const bscBalanceMapSpy = vi.fn();
vi.mock("./bscBalances", () => ({ bscBalanceMap: (...args: unknown[]) => bscBalanceMapSpy(...args) }));

const bscCatalogSnapshotSpy = vi.fn();
vi.mock("./rwaCatalog", () => ({ bscCatalogSnapshot: (...args: unknown[]) => bscCatalogSnapshotSpy(...args) }));

const priceAllSpy = vi.fn();
vi.mock("@/lib/prices", () => ({ priceAll: (...args: unknown[]) => priceAllSpy(...args) }));

vi.mock("./chain", () => ({ serverClient: () => ({}) }));

import { getBscHoldings } from "./bscHoldings";
import { getChain } from "@/lib/chains";
import type { RwaTickerView, VenueView } from "@/lib/rwa";

const bsc = getChain("bsc");
const ADDR = "0x1111111111111111111111111111111111111111" as const;
const NOW = Date.parse("2026-09-25T15:00:00.000Z");

// NVDA's default (bStock) + twin (Ondo) addresses, exactly as chains/bsc.assets.ts lists them.
const nvda = bsc.assets.stocks.find((a) => a.symbol === "NVDA")!;
const nvdaDefault = nvda.address!.toLowerCase();
const nvdaTwin = nvda.twin!.address.toLowerCase();
const btcb = bsc.assets.crypto.find((a) => a.symbol === "BTCB")!;
const btcbAddr = btcb.address!.toLowerCase();

function venue(overrides: Partial<VenueView> = {}): VenueView {
  return {
    platform: "bstock",
    symbol: "NVDAB",
    address: nvda.address!,
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
  return { ticker: "NVDA", name: "Nvidia", type: "stock", venues: [venue()], bestVenue: "bstock", ...overrides };
}

beforeEach(() => {
  bscBalanceMapSpy.mockReset();
  bscCatalogSnapshotSpy.mockReset().mockResolvedValue({ asOf: NOW, tickers: [] });
  priceAllSpy.mockReset().mockResolvedValue({});
});

describe("getBscHoldings", () => {
  it("returns null off BSC without reading anything", async () => {
    bscBalanceMapSpy.mockResolvedValue(new Map());
    const mantle = getChain("mantle");
    const holdings = await getBscHoldings(mantle, ADDR, NOW);
    expect(holdings).toBeNull();
    expect(bscBalanceMapSpy).not.toHaveBeenCalled();
  });

  it("prices a held stock at its own issuer's live catalog tokenPrice", async () => {
    bscBalanceMapSpy.mockResolvedValue(new Map([[nvdaDefault, BigInt(1) * BigInt(10) ** BigInt(18)]]));
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW, tickers: [ticker({ venues: [venue({ tokenPrice: 250 })] })] });

    const holdings = await getBscHoldings(bsc, ADDR, NOW);

    expect(holdings).toEqual([{ symbol: "NVDA", usdValue: 250, tier: "stock" }]);
  });

  it("sums both issuers of one stock into a single tiered position, each priced from its own venue", async () => {
    bscBalanceMapSpy.mockResolvedValue(
      new Map([
        [nvdaDefault, BigInt(1) * BigInt(10) ** BigInt(18)], // 1 bStock NVDA
        [nvdaTwin, BigInt(2) * BigInt(10) ** BigInt(18)], // 2 Ondo NVDA
      ]),
    );
    bscCatalogSnapshotSpy.mockResolvedValue({
      asOf: NOW,
      tickers: [
        ticker({
          venues: [
            venue({ platform: "bstock", address: nvda.address!, tokenPrice: 200 }),
            venue({ platform: "ondo", address: nvda.twin!.address, symbol: "NVDAon", tokenPrice: 210 }),
          ],
        }),
      ],
    });

    const holdings = await getBscHoldings(bsc, ADDR, NOW);

    // 1 * 200 (bStock) + 2 * 210 (Ondo) = 620, one row, never the twin's price borrowed for the
    // default balance or vice versa.
    expect(holdings).toEqual([{ symbol: "NVDA", usdValue: 620, tier: "stock" }]);
  });

  it("drops a held stock the catalog can't price right now, rather than inventing a value", async () => {
    bscBalanceMapSpy.mockResolvedValue(new Map([[nvdaDefault, BigInt(1) * BigInt(10) ** BigInt(18)]]));
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW, tickers: [] }); // NVDA missing from today's catalog entirely

    const holdings = await getBscHoldings(bsc, ADDR, NOW);

    expect(holdings).toEqual([]);
  });

  it("prices a held crypto position at the same quote price the app trades at", async () => {
    bscBalanceMapSpy.mockResolvedValue(new Map([[btcbAddr, BigInt(2) * BigInt(10) ** BigInt(18)]]));
    priceAllSpy.mockResolvedValue({ BTCB: { symbol: "BTCB", priceUsd: 60000, source: "binance" } });

    const holdings = await getBscHoldings(bsc, ADDR, NOW);

    expect(holdings).toEqual([{ symbol: "BTCB", usdValue: 120000, tier: "crypto" }]);
  });

  it("drops a held crypto position with no live price", async () => {
    bscBalanceMapSpy.mockResolvedValue(new Map([[btcbAddr, BigInt(2) * BigInt(10) ** BigInt(18)]]));
    priceAllSpy.mockResolvedValue({}); // no price source answered

    const holdings = await getBscHoldings(bsc, ADDR, NOW);

    expect(holdings).toEqual([]);
  });

  it("leaves an unheld asset (zero balance) out entirely", async () => {
    bscBalanceMapSpy.mockResolvedValue(new Map());
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW, tickers: [ticker()] });

    const holdings = await getBscHoldings(bsc, ADDR, NOW);

    expect(holdings).toEqual([]);
  });

  it("returns null (never a fabricated empty portfolio) when the balance read itself fails", async () => {
    bscBalanceMapSpy.mockRejectedValue(new Error("Binance Wallet API: rate limited"));

    const holdings = await getBscHoldings(bsc, ADDR, NOW);

    expect(holdings).toBeNull();
  });
});
