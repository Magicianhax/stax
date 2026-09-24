// BSC's curated baskets (Task 12, amendment E): only real bsc.assets.ts tickers, never a
// leveraged ETF (SOXL/TQQQ are listed there for manual trading but don't belong in a
// buy-and-hold curated basket), and every leg must clear Binance's $6 minimum at the
// basket's default invest amount — BasketDetailScreen opens its amount sheet on "100".
import { describe, expect, it } from "vitest";
import { assetBySymbol, getChain } from "./chains";
import { CURATED_BASKETS, curatedBaskets } from "./baskets";

const DEFAULT_BASKET_AMOUNT_USD = 100;
const BSC_MIN_LEG_USD = 6;
const NEVER_IN_A_CURATED_BASKET = new Set(["SOXL", "TQQQ"]); // leveraged ETFs

describe("BSC curated baskets", () => {
  const chain = getChain("bsc");
  const baskets = CURATED_BASKETS.bsc;

  it("ships at least two baskets, all fully investable today", () => {
    expect(baskets.length).toBeGreaterThanOrEqual(2);
    // curatedBaskets() re-checks routability at read time; nothing here should be filtered out.
    expect(curatedBaskets(chain).map((b) => b.id)).toEqual(baskets.map((b) => b.id));
  });

  it("only holds real BSC assets, never a leveraged ETF", () => {
    for (const b of baskets) {
      expect(b.items.length).toBeGreaterThan(0);
      for (const item of b.items) {
        expect(assetBySymbol(chain, item.symbol)).toBeDefined();
        expect(NEVER_IN_A_CURATED_BASKET.has(item.symbol)).toBe(false);
      }
    }
  });

  it("clears Binance's $6 minimum on every leg at the $100 default invest amount", () => {
    for (const b of baskets) {
      for (const item of b.items) {
        const usd = (item.weightPct / 100) * DEFAULT_BASKET_AMOUNT_USD;
        expect(usd).toBeGreaterThanOrEqual(BSC_MIN_LEG_USD);
      }
    }
  });
});
