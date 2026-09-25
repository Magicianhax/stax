import { describe, expect, it } from "vitest";
import { BSC, isRoutable } from "@/lib/chains";
import { BSC_MIN_LEG_USD } from "@/lib/rwa";
import {
  CLOSING_LINE,
  ELIGIBILITY_LINE,
  FAQ,
  HACK_LINE,
  HERO,
  HOW_TITLE,
  LANDING_BASKET_SLUGS,
  MOVES,
  OG_ALT,
  OTHER_NETWORKS_LINE,
  REFUSALS,
  REFUSE_TITLE,
  SITE_DESCRIPTION_BSC,
  andList,
  assetsLine,
  basketHoldingsLine,
  bscCrypto,
  bscName,
  bscStocks,
  contractLine,
  jargonIn,
  landingAssetRow,
  landingBaskets,
  marketNow,
} from "./landing";

const words = (s: string) => s.trim().split(/\s+/).length;

describe("what you can own", () => {
  it("lists every buyable BNB Chain stock and fund, the same filter the app uses", () => {
    const stocks = bscStocks();
    expect(stocks.length).toBe(42);
    expect(stocks.every((a) => a.tier === "stock" && isRoutable(BSC, a.symbol))).toBe(true);
  });

  it("has Bitcoin, Ethereum and BNB as crypto", () => {
    expect(bscCrypto().map((a) => a.symbol)).toEqual(["BTCB", "ETH", "BNB"]);
  });

  it("leaves leveraged funds out of the logo row but keeps everything else", () => {
    const row = landingAssetRow();
    expect(row.some((a) => a.risk === "leveraged")).toBe(false);
    expect(row.map((a) => a.symbol)).not.toContain("SOXL");
    expect(row.map((a) => a.symbol)).not.toContain("TQQQ");
    expect(row.length).toBe(bscStocks().length - 2 + bscCrypto().length);
  });

  it("says the count from the registry", () => {
    expect(assetsLine()).toBe("42 stocks and funds from bStock and Ondo, paid in USDT, plus Bitcoin, Ethereum and BNB.");
  });

  it("names a ticker with the registry's name when the design has none", () => {
    expect(bscName("CBRS")).toBe("Cerebras");
    expect(bscName("BTCB")).toBe("Bitcoin");
  });

  it("joins lists in plain English", () => {
    expect(andList([])).toBe("");
    expect(andList(["Base"])).toBe("Base");
    expect(andList(["Base", "Mantle"])).toBe("Base and Mantle");
    expect(andList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("baskets", () => {
  it("shows the six themed BNB Chain baskets, in order, all buyable", () => {
    const b = landingBaskets();
    expect(b.map((x) => x.id)).toEqual(LANDING_BASKET_SLUGS.map((s) => `bsc:${s}`));
    expect(b.every((x) => x.chain === "bsc" && x.items.every((i) => isRoutable(BSC, i.symbol)))).toBe(true);
  });

  it("never puts a leveraged fund in a landing basket", () => {
    for (const b of landingBaskets()) {
      expect(b.items.map((i) => i.symbol)).not.toContain("SOXL");
      expect(b.items.map((i) => i.symbol)).not.toContain("TQQQ");
    }
  });

  it("reads holdings by name", () => {
    const pre = landingBaskets().find((b) => b.id === "bsc:pre-ipo")!;
    expect(basketHoldingsLine(pre)).toBe("SpaceX · Cerebras");
  });
});

describe("marketNow", () => {
  // Fixed instants in UTC; the text is formatted in the runner's own time zone, so only the
  // state and the shape of the sentence are asserted.
  it("is open during a regular session", () => {
    const m = marketNow(Date.UTC(2026, 8, 23, 15, 0)); // Wed 11:00 ET
    expect(m.open).toBe(true);
    expect(m.text).toMatch(/^The US market is open · closes .+ your time$/);
  });

  it("is closed on a weekend and says when it opens", () => {
    const m = marketNow(Date.UTC(2026, 8, 26, 16, 0)); // Sat
    expect(m.open).toBe(false);
    expect(m.text).toMatch(/^The US market is closed · opens .+ your time$/);
  });

  it("is closed before the bell on a weekday", () => {
    const m = marketNow(Date.UTC(2026, 8, 23, 12, 0)); // Wed 08:00 ET
    expect(m.open).toBe(false);
  });
});

describe("copy", () => {
  const all = [
    HERO.title,
    HERO.sub,
    HOW_TITLE,
    REFUSE_TITLE,
    HACK_LINE,
    CLOSING_LINE,
    ELIGIBILITY_LINE,
    OTHER_NETWORKS_LINE,
    SITE_DESCRIPTION_BSC,
    OG_ALT,
    assetsLine(),
    contractLine([BSC]),
    ...MOVES.flatMap((m) => [m.title, m.note]),
    ...REFUSALS.flatMap((r) => [r.title, r.note]),
    ...FAQ.flatMap((f) => [f.q, f.a]),
  ];

  it("has no trader or crypto jargon", () => {
    for (const s of all) expect(jargonIn(s), s).toEqual([]);
  });

  it("catches jargon as whole words only", () => {
    expect(jargonIn("Best venue and low gas")).toEqual(["venue", "gas"]);
    expect(jargonIn("gasless")).toEqual([]);
  });

  it("keeps the hero inside its word budget", () => {
    expect(words(HERO.title)).toBeLessThanOrEqual(8);
    expect(words(HERO.sub)).toBeLessThanOrEqual(16);
  });

  it("italicises the title's own last word", () => {
    expect(HERO.title.endsWith(HERO.titleEm)).toBe(true);
  });

  it("keeps section headings short", () => {
    for (const h of [HOW_TITLE, REFUSE_TITLE]) expect(words(h)).toBeLessThanOrEqual(6);
  });

  it("walks the four moves in order", () => {
    expect(MOVES.map((m) => m.key)).toEqual(["goal", "plan", "check", "own"]);
  });

  it("prints the real minimum per stock", () => {
    expect(REFUSALS[1].title).toBe(`Less than $${BSC_MIN_LEG_USD} of a stock`);
    expect(FAQ.find((f) => f.q.startsWith("How much"))!.a).toContain(`$${BSC_MIN_LEG_USD} per stock`);
  });

  it("never calls Autopilot live on BNB Chain", () => {
    const a = FAQ.find((f) => f.a.includes("Autopilot"))!.a;
    expect(a).toMatch(/rolling out/);
  });

  it("names only the networks the contract is live on", () => {
    expect(contractLine([])).toBe("");
    expect(contractLine([BSC])).toMatch(/^On BNB Chain, a contract/);
  });

  it("mentions the BNB Hack as built for, not as a win", () => {
    expect(HACK_LINE).toMatch(/built for the BNB Hack: Tokenized Stocks Edition/);
    expect(HACK_LINE).not.toMatch(/win|won|award/i);
  });

  it("puts BNB Chain in the page metadata", () => {
    expect(SITE_DESCRIPTION_BSC).toMatch(/BNB Chain/);
    expect(OG_ALT).toMatch(/BNB Chain/);
  });
});
