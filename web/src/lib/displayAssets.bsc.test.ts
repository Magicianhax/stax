// Display copy for the crypto assets Wave 5 adds to BSC (bsc.assets.ts). Without an explicit
// entry, displayFor() falls back to stock-flavored copy ("A real company listed on the US stock
// market...") which is wrong for a crypto token — this pins that BTCB and BNB get their own,
// honest descriptions instead.
import { describe, expect, it } from "vitest";
import { displayFor } from "./displayAssets";

describe("BSC crypto display entries", () => {
  it("describes BTCB as crypto, not a fallback stock description", () => {
    const d = displayFor("BTCB");
    expect(d.kind).toBe("crypto");
    expect(d.cat).toBe("Crypto");
    expect(d.desc).toMatch(/bitcoin/i);
    expect(d.desc).not.toMatch(/stock market/i);
  });

  it("describes BNB as crypto, not a fallback stock description", () => {
    const d = displayFor("BNB");
    expect(d.kind).toBe("crypto");
    expect(d.cat).toBe("Crypto");
    expect(d.desc).not.toMatch(/stock market/i);
  });

  it("reuses the shared Ethereum description for BSC's Binance-Peg ETH", () => {
    const d = displayFor("ETH");
    expect(d.kind).toBe("crypto");
  });
});
