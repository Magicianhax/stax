// usMarketState / nextUsOpenMs — the BSC RWA catalog's fallback for bStock rows, which carry
// no session at all (docs/BINANCE-WEB3.md §2). Times are built in America/New_York so the
// tests don't depend on the machine's zone.
import { describe, expect, it } from "vitest";
import { usMarketState, nextUsOpenMs } from "./marketHours";

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
