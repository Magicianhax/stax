// usMarketState / nextUsOpenMs — the BSC RWA catalog's fallback for bStock rows, which carry
// no session at all (docs/BINANCE-WEB3.md §2). Times are built in America/New_York so the
// tests don't depend on the machine's zone.
import { describe, expect, it } from "vitest";
import { usMarketState, nextUsOpenMs, formatOpensLocal } from "./marketHours";

const ny = (iso: string) => new Date(new Date(iso + "-04:00").getTime()).getTime(); // EDT

describe("usMarketState", () => {
  it("is open during the regular session", () => expect(usMarketState(ny("2026-09-24T10:00:00"))).toBe("open"));
  it("is premarket before 09:30", () => expect(usMarketState(ny("2026-09-24T08:00:00"))).toBe("premarket"));
  it("is postmarket after 16:00", () => expect(usMarketState(ny("2026-09-24T17:00:00"))).toBe("postmarket"));
  it("is overnight in the small hours", () => expect(usMarketState(ny("2026-09-24T02:00:00"))).toBe("overnight"));
  it("is closed all weekend, including submission Sunday", () => {
    expect(usMarketState(ny("2026-10-10T12:00:00"))).toBe("closed"); // Saturday
    expect(usMarketState(ny("2026-10-11T12:00:00"))).toBe("closed"); // Sunday 11 Oct
  });
});

describe("nextUsOpenMs", () => {
  it("jumps a Sunday to Monday 09:30 New York", () => {
    expect(nextUsOpenMs(ny("2026-10-11T12:00:00"))).toBe(ny("2026-10-12T09:30:00"));
  });

  it("stays on the same day when the open is still ahead", () => {
    expect(nextUsOpenMs(ny("2026-09-24T08:00:00"))).toBe(ny("2026-09-24T09:30:00"));
  });

  it("rolls to the next trading day once today's open has passed", () => {
    expect(nextUsOpenMs(ny("2026-09-24T17:00:00"))).toBe(ny("2026-09-25T09:30:00"));
  });
});

// formatOpensLocal — the ONE "opens ..." formatter every screen and every BSC refusal shares
// (design critique P0 #1: MarketScreen said "ET", MarketStatusBadge said a bare local time,
// AssetDetailScreen said neither). It reads in the VIEWER's own clock, never a named zone, so
// the fixtures below build both instants with the same local `Date(y, m, d, h, mi)` constructor
// — whatever zone the test runner sits in, "now" and "next" are read back through it the same
// way, so the assertions hold on any machine.
describe("formatOpensLocal", () => {
  it("omits the weekday when the open is later the same local day", () => {
    const now = new Date(2026, 8, 24, 8, 0, 0).getTime();
    const next = new Date(2026, 8, 24, 18, 30, 0).getTime();
    expect(formatOpensLocal(next, now)).toBe("opens 6:30 PM your time");
  });

  it("includes the short local weekday when the open falls on a different local day", () => {
    const now = new Date(2026, 8, 25, 17, 0, 0).getTime(); // Fri
    const next = new Date(2026, 8, 28, 18, 30, 0).getTime(); // Mon
    expect(formatOpensLocal(next, now)).toBe("opens Mon 6:30 PM your time");
  });

  it("still says today across a midnight rollover only when the calendar day matches", () => {
    const now = new Date(2026, 8, 24, 23, 50, 0).getTime();
    const next = new Date(2026, 8, 25, 0, 5, 0).getTime();
    expect(formatOpensLocal(next, now)).toBe("opens Fri 12:05 AM your time");
  });
});
