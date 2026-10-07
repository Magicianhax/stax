// resolveVenueAddress is the single place a BSC manual trade turns "which issuer" into "which
// token address". /api/swap-quote, useQuote/useSwap and the portfolio's twin-holding rows all
// need the same answer, so it is pure and tested here rather than re-derived in each caller.
import { describe, expect, it } from "vitest";
import { getChain } from "./chains";
import { holdingKey, holdingToken, holdingVenue, pickHolding, resolveVenueAddress } from "./venues";

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

describe("holdingVenue", () => {
  // Regression for the "twin bought, wrong token sold" bug: the portfolio sorts holding rows by
  // value, so with no venue picked the Ondo twin can be the FIRST row for a ticker. A lookup that
  // takes "the first row" (or matches on `venue === undefined`) can pick that twin row while the
  // trade itself resolves and sells the default (bStock) token, because those two decisions used
  // different rules. `holdingVenue` is the one rule both the holding lookup and the venue label
  // must use, so they can never disagree about which issuer a trade means.
  it("defaults to the asset's own platform when no venue is picked", () => {
    expect(holdingVenue(bsc, nvda)).toBe(nvda.platform);
  });

  it("returns the picked venue when one is given", () => {
    expect(holdingVenue(bsc, nvda, nvda.twin!.platform)).toBe(nvda.twin!.platform);
  });

  it("ignores venue entirely off BSC (there's only ever one row per symbol there)", () => {
    const nvdaBase = base.assets.all.find((a) => a.symbol === "NVDA");
    if (!nvdaBase) return;
    expect(holdingVenue(base, nvdaBase, "ondo")).toBeUndefined();
  });
});

describe("pickHolding / holdingKey", () => {
  const rows = [
    { asset: { symbol: "NVDA" }, venue: "ondo" as const, qty: 3 },
    { asset: { symbol: "NVDA" }, venue: "bstock" as const, qty: 1 },
  ];

  it("defaults to the asset's own platform, not the first (highest-value) row", () => {
    expect(pickHolding(rows, bsc, nvda)?.venue).toBe(nvda.platform);
  });

  it("shows the venue the screen was opened for", () => {
    expect(pickHolding(rows, bsc, nvda, "ondo")?.qty).toBe(3);
  });

  it("still finds a twin-only position", () => {
    expect(pickHolding([rows[0]], bsc, nvda)?.venue).toBe("ondo");
  });

  it("gives the two issuers of one symbol different keys", () => {
    expect(holdingKey(rows[0])).not.toBe(holdingKey(rows[1]));
    expect(holdingKey({ asset: { symbol: "AAPL" } })).toBe("AAPL");
  });
});

describe("holdingToken", () => {
  it("is the default issuer's token for the default row", () => {
    expect(holdingToken(bsc, { asset: nvda, venue: nvda.platform })).toEqual({ address: nvda.address, decimals: nvda.decimals });
  });

  it("is the OTHER issuer's token, in its own decimals, for a twin row (Send must not move the default token)", () => {
    const t = holdingToken(bsc, { asset: nvda, venue: nvda.twin!.platform })!;
    expect(t.address).toBe(nvda.twin!.address);
    expect(t.address).not.toBe(nvda.address);
    expect(t.decimals).toBe(nvda.twin!.decimals);
  });

  it("is the asset's own token when the row has no venue (Base and Mantle)", () => {
    const nvdaBase = base.assets.all.find((a) => a.symbol === "NVDA");
    if (!nvdaBase) return;
    expect(holdingToken(base, { asset: nvdaBase })).toEqual({ address: nvdaBase.address, decimals: nvdaBase.decimals });
  });

  it("is null for an issuer the asset doesn't list", () => {
    const amzn = bsc.assets.all.find((a) => a.symbol === "AMZN")!;
    expect(holdingToken(bsc, { asset: amzn, venue: "bstock" })).toBeNull();
  });
});
