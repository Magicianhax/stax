// resolveVenueAddress is the single place a BSC manual trade turns "which issuer" into "which
// token address". /api/swap-quote, useQuote/useSwap and the portfolio's twin-holding rows all
// need the same answer, so it is pure and tested here rather than re-derived in each caller.
import { describe, expect, it } from "vitest";
import { getChain } from "./chains";
import { resolveVenueAddress } from "./venues";

const bsc = getChain("bsc");
const base = getChain("base");
const nvda = bsc.assets.all.find((a) => a.symbol === "NVDA")!;

describe("resolveVenueAddress", () => {
  it("defaults to the asset's own address when no venue is given", () => {
    const r = resolveVenueAddress(bsc, nvda);
    expect(r).toEqual({ address: nvda.address, platform: nvda.platform });
  });

  it("resolves to the asset's own address when the venue matches its own platform", () => {
    const r = resolveVenueAddress(bsc, nvda, nvda.platform);
    expect(r).toEqual({ address: nvda.address, platform: nvda.platform });
  });

  it("resolves to the twin's address when the venue is the twin's platform", () => {
    const r = resolveVenueAddress(bsc, nvda, nvda.twin!.platform);
    expect(r).toEqual({ address: nvda.twin!.address, platform: nvda.twin!.platform });
  });

  it("refuses a venue the asset doesn't have (null, for the caller to turn into a 400)", () => {
    // AMZN on BSC is Ondo-only in the curated list (no twin).
    const amzn = bsc.assets.all.find((a) => a.symbol === "AMZN")!;
    expect(amzn.twin).toBeUndefined();
    expect(resolveVenueAddress(bsc, amzn, "bstock")).toBeNull();
  });

  it("ignores venue entirely on a non-BSC chain", () => {
    const nvdaBase = base.assets.all.find((a) => a.symbol === "NVDA");
    if (!nvdaBase) return; // Base's asset list is independent; skip if this ticker isn't there
    const r = resolveVenueAddress(base, nvdaBase, "ondo");
    expect(r).toEqual({ address: nvdaBase.address, platform: nvdaBase.platform });
  });

  it("returns null for an asset with no address at all", () => {
    const noAddress = { symbol: "X", name: "X", tier: "stock", via: "route" } as const;
    expect(resolveVenueAddress(bsc, noAddress)).toBeNull();
  });
});
