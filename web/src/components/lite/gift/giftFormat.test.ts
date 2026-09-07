// Gift timing: a gift may open the same day, so these read and print instants in
// the reader's own zone rather than in UTC.
import { describe, expect, it } from "vitest";
import {
  countdownTo,
  earliestUnlock,
  fromDateTimeInput,
  resolveUnlock,
  toDateTimeInput,
  todayAnchor,
  unlockLocal,
  unlockWhenFromSeconds,
  untilLabel,
} from "./giftFormat";

describe("gift unlock timing", () => {
  it("earliest unlock is minutes ahead, not a day", () => {
    const now = Date.UTC(2026, 8, 8, 12, 0, 0);
    expect(earliestUnlock(15, now)).toBe(Math.floor(now / 1000) + 900);
  });

  it("round-trips a datetime field in local time", () => {
    const at = Math.floor(Date.UTC(2026, 8, 8, 12, 34) / 1000);
    const field = toDateTimeInput(at);
    expect(field).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Back to the same minute, whatever the machine's zone.
    expect(fromDateTimeInput(field)).toBe(at - (at % 60));
  });

  it("rejects a malformed field", () => {
    expect(fromDateTimeInput("")).toBeNull();
    expect(fromDateTimeInput("2026-09-08")).toBeNull();
  });

  it("shows the time for a gift opening today, and only the date for a distant one", () => {
    const now = Date.UTC(2026, 8, 8, 12, 0, 0);
    const soon = Math.floor(now / 1000) + 3600;
    const far = Math.floor(now / 1000) + 400 * 86_400;
    expect(unlockWhenFromSeconds(soon, now)).toMatch(/\d{1,2}:\d{2}/);
    expect(unlockWhenFromSeconds(far, now)).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("resolveUnlock", () => {
  const now = Math.floor(Date.UTC(2026, 8, 8, 9, 30) / 1000);
  const today = todayAnchor(now * 1000);

  it("counts days from now, not from midnight", () => {
    expect(resolveUnlock("days", today, "", "", "45", now)).toBe(now + 45 * 86_400);
    expect(resolveUnlock("days", today, "", "", "1", now)).toBe(now + 86_400);
  });

  it("refuses a days value that is not a whole number of days ahead", () => {
    for (const bad of ["", "0", "-3", "2.5", "abc"]) {
      expect(resolveUnlock("days", today, "", "", bad, now), bad).toBeNull();
    }
  });

  it("still resolves the other presets", () => {
    expect(resolveUnlock("1y", today, "", "", "", now)).toBeGreaterThan(now);
    expect(resolveUnlock("18th", today, "2020-05-01", "", "", now)).toBeGreaterThan(now);
    expect(resolveUnlock("18th", today, "", "", "", now)).toBeNull();
    expect(resolveUnlock(null, today, "", "", "", now)).toBeNull();
  });
});

// Local instants on purpose: "tomorrow" is a fact about the reader's calendar, so
// the test has to ask the same calendar the code does.
const iso = (ms: number) => new Date(ms).toISOString();

describe("untilLabel", () => {
  const noon = new Date(2026, 8, 8, 12, 0, 0).getTime();

  it("says a gift already open is open", () => {
    expect(untilLabel(iso(noon - 1000), noon)).toBe("Ready now");
    expect(untilLabel(iso(noon), noon)).toBe("Ready now");
  });

  it("counts minutes, then hours, inside the same day", () => {
    expect(untilLabel(iso(noon + 30 * 60_000), noon)).toBe("in 30 min");
    expect(untilLabel(iso(noon + 5 * 3_600_000), noon)).toBe("in 5 hours");
  });

  it("only says Tomorrow when the calendar day actually changes", () => {
    // Two hours away used to read "Tomorrow", because the gap was rounded up to a day.
    expect(untilLabel(iso(noon + 2 * 3_600_000), noon)).toBe("in 2 hours");
    expect(untilLabel(iso(noon + 25 * 3_600_000), noon)).toBe("Tomorrow");
  });

  it("keeps the longer horizons", () => {
    expect(untilLabel(iso(noon + 12 * 86_400_000), noon)).toBe("in 12 days");
    expect(untilLabel(iso(noon + 400 * 86_400_000), noon)).toBe("in 13 months");
  });
});

describe("countdownTo", () => {
  const now = Date.UTC(2026, 8, 8, 12, 0, 0);

  it("breaks the wait into days, hours, minutes and seconds", () => {
    const at = now + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000;
    expect(countdownTo(iso(at), now)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5, done: false });
  });

  it("is done the moment the gift opens", () => {
    expect(countdownTo(iso(now), now).done).toBe(true);
    expect(countdownTo(iso(now - 5000), now).done).toBe(true);
  });
});

describe("unlockLocal", () => {
  const noon = new Date(2026, 8, 8, 12, 0, 0).getTime();

  it("shows the time for a gift opening within three days", () => {
    expect(unlockLocal(iso(noon + 6 * 3_600_000), noon)).toMatch(/\d{1,2}:\d{2}/);
  });

  it("shows only the date for a distant one", () => {
    const far = unlockLocal(iso(noon + 400 * 86_400_000), noon);
    expect(far).not.toMatch(/\d{1,2}:\d{2}/);
    expect(far).toContain("2027");
  });
});
