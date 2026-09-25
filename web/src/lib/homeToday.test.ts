import { describe, expect, it } from "vitest";
import { todayMarketLine } from "./homeToday";

describe("todayMarketLine", () => {
  it("reads open during a regular Wednesday session", () => {
    // Wed 2026-03-11 10:00 ET = 14:00 UTC (EDT, per marketHours.ts's own verification table).
    const nowMs = Date.UTC(2026, 2, 11, 14, 0, 0);
    expect(todayMarketLine(nowMs)).toBe("Open now");
  });

  it("names the closed market and the next open, in the caller's local words", () => {
    // Sat 2026-03-14 12:00 UTC — a weekend, market closed, next open is Monday.
    const nowMs = Date.UTC(2026, 2, 14, 12, 0, 0);
    const line = todayMarketLine(nowMs);
    expect(line.startsWith("US market closed · opens")).toBe(true);
    expect(line).toContain("your time");
  });
});
