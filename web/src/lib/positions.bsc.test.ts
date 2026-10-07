// Portfolio history reads Vera's executor fills (LegFilled rows) by the token each leg bought.
// On BNB Chain a leg can buy either issuer of a stock (bStock or Ondo), so a fill of the twin's
// token must still count as that stock, in the twin's own decimals, or an executor buy of Ondo
// NVDA would drop out of the person's history.
import { describe, expect, it } from "vitest";
import { getChain } from "./chains";
import { legTokenIndex } from "./positions";

describe("legTokenIndex", () => {
  const bsc = getChain("bsc");
  const nvda = bsc.assets.all.find((a) => a.symbol === "NVDA")!;

  it("maps both issuers' tokens to the stock, each with its own decimals", () => {
    const index = legTokenIndex(bsc);
    expect(index.get(nvda.address!.toLowerCase())).toEqual({ symbol: "NVDA", decimals: nvda.decimals ?? 18 });
    expect(index.get(nvda.twin!.address.toLowerCase())).toEqual({ symbol: "NVDA", decimals: nvda.twin!.decimals });
  });

  it("is unchanged off BSC: one entry per asset address, nothing else", () => {
    const base = getChain("base");
    const index = legTokenIndex(base);
    const withAddress = base.assets.all.filter((a) => a.address);
    expect(index.size).toBe(new Set(withAddress.map((a) => a.address!.toLowerCase())).size);
    for (const a of withAddress) expect(index.get(a.address!.toLowerCase())?.symbol).toBeDefined();
  });
});
