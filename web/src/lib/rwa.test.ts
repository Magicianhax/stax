// The two rules the whole market-hours layer rests on: what "buyable" means, and how the
// gap between a token and the real share is measured.
import { describe, expect, it } from "vitest";
import { BSC_MIN_LEG_USD, BSC_MIN_SELL_USD, gapPct, isBuyable, marketStateFrom, minLegUsd, sellShareClearsFloor, bscSellBlocked, venueBuyable, venueState } from "./rwa";

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

describe("the sell floor", () => {
  it("is Binance's real floor, below the buy buffer", () => {
    expect(minLegUsd("buy")).toBe(BSC_MIN_LEG_USD);
    expect(minLegUsd("sell")).toBe(BSC_MIN_SELL_USD);
    expect(BSC_MIN_SELL_USD).toBeGreaterThan(5);
    expect(BSC_MIN_SELL_USD).toBeLessThan(BSC_MIN_LEG_USD);
  });

  it("lets All through on a $5.97 position but not 50%", () => {
    expect(sellShareClearsFloor(5.97, 100)).toBe(true);
    expect(sellShareClearsFloor(5.97, 50)).toBe(false);
  });

  it("disables 25% under $20.04 and leaves chips on when the value is unknown", () => {
    expect(sellShareClearsFloor(24, 25)).toBe(true);
    expect(sellShareClearsFloor(20, 25)).toBe(false);
    expect(sellShareClearsFloor(undefined, 25)).toBe(true);
    expect(sellShareClearsFloor(Number.NaN, 25)).toBe(true);
  });
});

describe("bscSellBlocked", () => {
  it("never blocks a crypto sell, which has no catalog row", () => {
    expect(bscSellBlocked("crypto", undefined)).toBe(false);
  });
  it("blocks a stock until its issuer is buyable, and fails closed with no row", () => {
    expect(bscSellBlocked("stock", undefined)).toBe(true);
    expect(bscSellBlocked("stock", { buyable: false })).toBe(true);
    expect(bscSellBlocked("stock", { buyable: true })).toBe(false);
  });
});

describe("venueBuyable: the trade gate and the catalog share one rule", () => {
  const bstockTrading = { openState: true, marketStatus: null, reasonCode: "TRADING" as const };
  const THU_OPEN = Date.parse("2026-09-24T15:00:00.000Z"); // 11:00 ET
  const FRI_AFTER_CLOSE = Date.parse("2026-09-26T16:00:00.000Z"); // Saturday noon ET: the NYSE is shut

  it("lets a trading bStock row through while the US market is open", () => {
    expect(venueBuyable(bstockTrading, THU_OPEN)).toBe(true);
  });

  it("refuses the same row on a closed day even though the issuer still says TRADING (no weekend-premium buys)", () => {
    expect(venueState(bstockTrading, FRI_AFTER_CLOSE)).toBe("closed");
    expect(venueBuyable(bstockTrading, FRI_AFTER_CLOSE)).toBe(false);
  });

  it("still lets Ondo trade overnight, because its own session says so", () => {
    const ondoOvernight = { openState: true, marketStatus: "overnight" as const, reasonCode: "TRADING" as const };
    expect(venueBuyable(ondoOvernight, FRI_AFTER_CLOSE)).toBe(true);
  });
});
