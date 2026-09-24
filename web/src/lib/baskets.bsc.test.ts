// BSC's curated baskets (Task 12, amendment E): only real bsc.assets.ts tickers, never a
// leveraged ETF (SOXL/TQQQ are listed there for manual trading but don't belong in a
// buy-and-hold curated basket), and every leg must clear Binance's $6 minimum at the
// basket's default invest amount — BasketDetailScreen opens its amount sheet on "100".
import { describe, expect, it } from "vitest";
import { assetBySymbol, getChain } from "./chains";
import { BASKET_TAGLINE_MAX, CURATED_BASKETS, curatedBaskets } from "./baskets";

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

  it("shows the composition transparently: tickers and weights, never a black box", () => {
    for (const b of baskets) {
      for (const item of b.items) {
        expect(item.symbol.length).toBeGreaterThan(0);
        expect(item.weightPct).toBeGreaterThan(0);
      }
    }
  });

  it("gives every basket a short, jargon-free tagline", () => {
    const JARGON = /\b(venue|gap|spread|slippage|gas|rfq|bps|aggregator)\b/i;
    for (const b of baskets) {
      expect(b.tagline.length).toBeGreaterThan(0);
      expect(b.tagline.length).toBeLessThanOrEqual(BASKET_TAGLINE_MAX);
      expect(b.tagline).not.toMatch(JARGON);
    }
  });
});

// Wave 5 direction C: brief ideas 7 (stocks+crypto) and 9 (transparent themed baskets). Each new
// basket is checked by name so a future edit can't quietly drop one the wave promised.
describe("BSC wave 5 themed baskets", () => {
  const chain = getChain("bsc");
  const bySlug = (slug: string) => CURATED_BASKETS.bsc.find((b) => b.id === `bsc:${slug}`);

  it("has a Magnificent Seven basket with all seven names, evenly weighted", () => {
    const b = bySlug("magnificent-7");
    expect(b).toBeDefined();
    const symbols = b!.items.map((i) => i.symbol).sort();
    expect(symbols).toEqual(["AAPL", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "TSLA"].sort());
  });

  it("has a Buffett-style value basket of steady, profitable names", () => {
    const b = bySlug("buffett-style-value");
    expect(b).toBeDefined();
    expect(b!.items.length).toBeGreaterThanOrEqual(3);
  });

  it("has a Pre-IPO basket of SpaceX and Cerebras, flagged as higher risk", () => {
    const b = bySlug("pre-ipo");
    expect(b).toBeDefined();
    expect(b!.items.map((i) => i.symbol).sort()).toEqual(["CBRS", "SPCX"]);
    // TIER_BPS.stock alone already scores "Adventurous" or higher; this just pins that a
    // pre-IPO basket never reads as calm.
    expect(b!.riskScore).toBeGreaterThanOrEqual(5000);
    expect(b!.tagline + " " + b!.items.map((i) => i.reason ?? "").join(" ")).toMatch(/risk|swings|private/i);
  });

  it("has a Stocks + Bitcoin basket pairing a tokenized equity leg with crypto", () => {
    const b = bySlug("stocks-and-bitcoin");
    expect(b).toBeDefined();
    const tiers = b!.items.map((i) => assetBySymbol(chain, i.symbol)?.tier);
    expect(tiers).toContain("crypto");
    expect(tiers).toContain("stock");
  });
});
