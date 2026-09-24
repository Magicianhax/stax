// The two rules the whole market-hours layer rests on: what "buyable" means, and how the
// gap between a token and the real share is measured.
import { describe, expect, it } from "vitest";
import { BSC_MIN_LEG_USD, gapPct, isBuyable, marketStateFrom } from "./rwa";

describe("isBuyable", () => {
  it("is true only when open AND trading", () => {
    expect(isBuyable({ openState: true, reasonCode: "TRADING" })).toBe(true);
    expect(isBuyable({ openState: false, reasonCode: "TRADING" })).toBe(false);
    expect(isBuyable({ openState: true, reasonCode: "MARKET_PAUSED" })).toBe(false);
    expect(isBuyable({ openState: true, reasonCode: "UNSUPPORTED" })).toBe(false);
  });
});

describe("gapPct", () => {
  it("is the token's premium over the reference, in percent", () => {
    expect(gapPct(101, 100)).toBeCloseTo(1, 6);
    expect(gapPct(99, 100)).toBeCloseTo(-1, 6);
    expect(gapPct(100, 100)).toBe(0);
  });

  it("is null when the reference is missing or zero, never Infinity", () => {
    expect(gapPct(100, 0)).toBeNull();
    expect(gapPct(100, Number.NaN)).toBeNull();
  });
});

describe("BSC_MIN_LEG_USD", () => {
  it("clears Binance's $5 floor, which is exclusive", () => {
    expect(BSC_MIN_LEG_USD).toBeGreaterThan(5);
  });
});

describe("marketStateFrom", () => {
  it("maps the API's regular session to open", () => {
    expect(marketStateFrom({ marketStatus: "regular", reasonCode: "TRADING" })).toBe("open");
  });

  it("accepts both spellings of paused, because docs and live data disagree", () => {
    expect(marketStateFrom({ marketStatus: "paused", reasonCode: "MARKET_PAUSED" })).toBe("paused");
    expect(marketStateFrom({ marketStatus: "pause", reasonCode: "MARKET_PAUSED" })).toBe("paused");
  });

  it("reports an unsupported token as unsupported, whatever the session", () => {
    expect(marketStateFrom({ marketStatus: "premarket", reasonCode: "UNSUPPORTED" })).toBe("unsupported");
  });

  it("passes the other sessions through", () => {
    for (const s of ["premarket", "postmarket", "overnight", "closed"] as const) {
      expect(marketStateFrom({ marketStatus: s, reasonCode: "TRADING" })).toBe(s);
    }
  });

  it("is null when the API gives no session, so the caller falls back to the US calendar", () => {
    // Every bStock row looks like this.
    expect(marketStateFrom({ marketStatus: null, reasonCode: "TRADING" })).toBeNull();
  });
});
