// Gift timing: a gift may open the same day, so these read and print instants in
// the reader's own zone rather than in UTC.
import { describe, expect, it } from "vitest";
import { earliestUnlock, fromDateTimeInput, toDateTimeInput, unlockWhenFromSeconds } from "./giftFormat";

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
