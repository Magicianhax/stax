import { describe, expect, it } from "vitest";
import { withChainParam } from "./chainUrl";

describe("withChainParam", () => {
  it("adds the chain to a bare API URL and to one that already has a query", () => {
    expect(withChainParam("/api/prices", "bsc")).toBe("/api/prices?chain=bsc");
    expect(withChainParam("/api/portfolio?address=0xabc", "base")).toBe("/api/portfolio?address=0xabc&chain=base");
  });

  it("leaves an explicit chain alone", () => {
    expect(withChainParam("/api/rwa?chain=bsc", "base")).toBe("/api/rwa?chain=bsc");
  });

  it("keeps a fragment after the query", () => {
    expect(withChainParam("/api/prices#x", "bsc")).toBe("/api/prices?chain=bsc#x");
  });

  it("only touches GETs to our own API", () => {
    expect(withChainParam("/api/invest-plan", "bsc", "POST")).toBe("/api/invest-plan");
    expect(withChainParam("https://example.com/x", "bsc")).toBe("https://example.com/x");
    expect(withChainParam("/gift/abc", "bsc")).toBe("/gift/abc");
  });

  it("gives each network its own URL, which is what keys the edge cache", () => {
    expect(withChainParam("/api/prices", "bsc")).not.toBe(withChainParam("/api/prices", "base"));
  });
});
