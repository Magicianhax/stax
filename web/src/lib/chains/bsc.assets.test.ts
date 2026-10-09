// Wave 5 direction A: BTCB, ETH and BNB (as WBNB) are plain crypto on BSC, traded through the
// same Binance aggregator as the tokenized stocks. This pins the facts every crypto-aware
// caller (allocate.ts's universe, bscPlan's leg builder, prices.ts) depends on: real addresses,
// 18 decimals, `via: "binance"`, no `platform`/`twin` (they aren't RWA tokens), and routable.
import { describe, expect, it } from "vitest";
import { assetBySymbol, getChain, investableAssets, isRoutable } from "./index";

const CRYPTO_SYMBOLS = ["BTCB", "ETH", "BNB"] as const;
const CRYPTO_ADDRESSES: Record<string, `0x${string}`> = {
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  BNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
};

describe("BSC crypto assets", () => {
  const chain = getChain("bsc");

  it("lists BTCB, ETH and BNB in the crypto tier with the verified live addresses", () => {
    for (const symbol of CRYPTO_SYMBOLS) {
      const asset = assetBySymbol(chain, symbol);
      expect(asset).toBeDefined();
      expect(asset?.tier).toBe("crypto");
      expect(asset?.via).toBe("binance");
      expect(asset?.decimals).toBe(18);
      expect(asset?.address?.toLowerCase()).toBe(CRYPTO_ADDRESSES[symbol].toLowerCase());
    }
  });

  it("carries no platform/twin — crypto isn't an RWA token with an issuer choice", () => {
    for (const symbol of CRYPTO_SYMBOLS) {
      const asset = assetBySymbol(chain, symbol);
      expect(asset?.platform).toBeUndefined();
      expect(asset?.twin).toBeUndefined();
    }
  });

  it("is routable like any other Binance-aggregator asset", () => {
    for (const symbol of CRYPTO_SYMBOLS) {
      expect(isRoutable(chain, symbol)).toBe(true);
    }
  });

  it("is part of the general investable universe (before any BSC-specific catalog filter)", () => {
    const symbols = investableAssets(chain).map((a) => a.symbol);
    for (const symbol of CRYPTO_SYMBOLS) expect(symbols).toContain(symbol);
  });

  it("leaves the stock tier and other chains untouched", () => {
    expect(chain.assets.stocks.some((a) => CRYPTO_SYMBOLS.includes(a.symbol as (typeof CRYPTO_SYMBOLS)[number]))).toBe(false);
    expect(getChain("base").assets.crypto.some((a) => a.symbol === "BTCB")).toBe(false);
  });
});

// Design critique P1 #6: SOXL and TQQQ are 3x leveraged ETFs and CBRS is a pre-IPO share,
// listed like any household stock. The flag drives Market's "Riskier picks" group, their own
// plain warning line, and keeping leveraged funds out of Vera's default picks.
describe("BSC risk flags", () => {
  const chain = getChain("bsc");

  it("flags the 3x leveraged funds", () => {
    expect(assetBySymbol(chain, "SOXL")?.risk).toBe("leveraged");
    expect(assetBySymbol(chain, "TQQQ")?.risk).toBe("leveraged");
  });

  it("flags the pre-IPO private company", () => {
    expect(assetBySymbol(chain, "CBRS")?.risk).toBe("preipo");
  });

  it("no longer flags SpaceX, which is listed now", () => {
    expect(assetBySymbol(chain, "SPCX")?.risk).toBeUndefined();
  });

  it("leaves ordinary stocks and funds unflagged", () => {
    for (const s of ["NVDA", "AAPL", "SPY", "QQQ", "BTCB"]) expect(assetBySymbol(chain, s)?.risk).toBeUndefined();
  });
});
