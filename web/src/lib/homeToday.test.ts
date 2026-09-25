import { describe, expect, it } from "vitest";
import { marketHeaderLine, todayMarketLine } from "./homeToday";
import { formatClosesLocal, formatOpensLocal, nextUsOpenMs } from "./marketHours";

// Wed 2026-03-11 10:00 ET = 14:00 UTC (EDT, per marketHours.ts's own verification table); the
// regular session closes 16:00 ET = 20:00 UTC.
const OPEN_NOW = Date.UTC(2026, 2, 11, 14, 0, 0);
const OPEN_CLOSES = Date.UTC(2026, 2, 11, 20, 0, 0);
// Sat 2026-03-14 12:00 UTC — a weekend, market closed, next open is Monday.
const CLOSED_NOW = Date.UTC(2026, 2, 14, 12, 0, 0);

describe("todayMarketLine", () => {
  it("names the US market and when it closes, in the viewer's own clock", () => {
    expect(todayMarketLine(OPEN_NOW)).toBe(`US market open · ${formatClosesLocal(OPEN_CLOSES, OPEN_NOW)}`);
  });

  it("never reads a bare 'Open now' that a closed-looking row could contradict", () => {
    expect(todayMarketLine(OPEN_NOW)).not.toBe("Open now");
  });

  it("names the closed market and the next open, in the caller's local words", () => {
    expect(todayMarketLine(CLOSED_NOW)).toBe(
      `US market closed · ${formatOpensLocal(nextUsOpenMs(CLOSED_NOW), CLOSED_NOW)}`,
    );
  });
});

describe("marketHeaderLine", () => {
  it("adds that some stocks still trade through Ondo while the US market is closed", () => {
    expect(marketHeaderLine(CLOSED_NOW, ["Ondo"])).toBe(
      `${todayMarketLine(CLOSED_NOW)} · some stocks still trade through Ondo`,
    );
  });

  it("names both issuers when both are still trading", () => {
    expect(marketHeaderLine(CLOSED_NOW, ["bStock", "Ondo"])).toBe(
      `${todayMarketLine(CLOSED_NOW)} · some stocks still trade through bStock and Ondo`,
    );
  });

  it("adds nothing when no issuer is trading", () => {
    expect(marketHeaderLine(CLOSED_NOW, [])).toBe(todayMarketLine(CLOSED_NOW));
  });

  it("adds nothing while the US market is open (every issuer trading is the normal case)", () => {
    expect(marketHeaderLine(OPEN_NOW, ["Ondo"])).toBe(todayMarketLine(OPEN_NOW));
  });
});
