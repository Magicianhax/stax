// assetLogo — the one place a screen asks "which logo for this symbol, on this chain, from this
// issuer". On BSC a tokenized stock has two branded logos (bStock's and Ondo's); everywhere else
// there's exactly one logo per symbol (displayAssets.ts), unaffected by chain or venue.
import { describe, expect, it } from "vitest";
import { assetLogo } from "./assetLogo";
import { getChain } from "./chains";
import { displayFor } from "./displayAssets";

const bsc = getChain("bsc");
const base = getChain("base");
const mantle = getChain("mantle");

describe("assetLogo on BSC", () => {
  it("defaults to the asset's own issuer's logo when no venue is given", () => {
    // NVDA's default platform is bstock (bsc.assets.ts).
    const nvda = bsc.assets.stocks.find((a) => a.symbol === "NVDA")!;
    expect(assetLogo(bsc, "NVDA")).toBe(nvda.logo);
    expect(assetLogo(bsc, "NVDA")).not.toBe(nvda.twin?.logo);
  });

  it("returns the twin's own logo when venue names the twin's platform", () => {
    const nvda = bsc.assets.stocks.find((a) => a.symbol === "NVDA")!;
    expect(assetLogo(bsc, "NVDA", "ondo")).toBe(nvda.twin?.logo);
    expect(assetLogo(bsc, "NVDA", "ondo")).not.toBe(nvda.logo);
  });

  it("returns the asset's own logo when venue explicitly names its own platform", () => {
    const nvda = bsc.assets.stocks.find((a) => a.symbol === "NVDA")!;
    expect(assetLogo(bsc, "NVDA", "bstock")).toBe(nvda.logo);
  });

  it("falls back to displayFor's logo for a symbol with no BSC listing", () => {
    expect(assetLogo(bsc, "totally-unknown-symbol")).toBe(displayFor("totally-unknown-symbol").logo);
  });

  it("falls back to displayFor's logo for crypto (no issuer platform to resolve)", () => {
    expect(assetLogo(bsc, "BTCB")).toBe(displayFor("BTCB").logo);
    expect(assetLogo(bsc, "BTCB", "ondo")).toBe(displayFor("BTCB").logo);
  });

  it("AMZN has no twin, so any venue still returns its own (Ondo) logo", () => {
    const amzn = bsc.assets.stocks.find((a) => a.symbol === "AMZN")!;
    expect(assetLogo(bsc, "AMZN")).toBe(amzn.logo);
    expect(assetLogo(bsc, "AMZN", "bstock")).toBe(amzn.logo);
  });
});

describe("assetLogo off BSC — output is unchanged from displayFor", () => {
  it("Base: matches displayFor(symbol).logo regardless of a stray venue argument", () => {
    expect(assetLogo(base, "AAPL")).toBe(displayFor("AAPL").logo);
    expect(assetLogo(base, "AAPL", "ondo")).toBe(displayFor("AAPL").logo);
    expect(assetLogo(base, "BTC")).toBe(displayFor("BTC").logo);
  });

  it("Mantle: matches displayFor(symbol).logo regardless of a stray venue argument", () => {
    expect(assetLogo(mantle, "AAPL")).toBe(displayFor("AAPL").logo);
    expect(assetLogo(mantle, "AAPL", "bstock")).toBe(displayFor("AAPL").logo);
  });
});
