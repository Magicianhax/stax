// Pure helpers for the earnings-calendar chip: day counting and the copy that reads it aloud.
// No network here — lib/server/earnings.ts owns fetching; this file only turns an already-known
// { nextMs, confirmed } into what a person reads. Local-Date arithmetic throughout (not UTC
// epoch math) so a day boundary always lands where the *viewer's* clock says midnight is, same
// convention as marketHours.ts's formatOpensLocal ("your time").
import { describe, expect, it } from "vitest";
import { daysUntil, earningsChipText, formatEarningsDateLocal, type EarningsInfo } from "./earnings";

// A fixed "now": a local Tuesday. Built with local Date components (not an ISO "Z" string) so
// the test means the same thing on every machine's time zone, including this one's (UTC+5ish).
const NOW = new Date(2026, 9, 25, 9, 0, 0).getTime(); // Sun Oct 25 2026, local 9am

function local(y: number, m: number, d: number, h = 9): number {
  return new Date(y, m, d, h).getTime();
}

describe("daysUntil", () => {
  it("is 0 for later the same local day", () => {
    expect(daysUntil(local(2026, 9, 25, 23), NOW)).toBe(0);
  });

  it("is 1 for tomorrow", () => {
    expect(daysUntil(local(2026, 9, 26), NOW)).toBe(1);
  });

  it("is 3 for three days out", () => {
    expect(daysUntil(local(2026, 9, 28), NOW)).toBe(3);
  });

  it("is negative for a date already past", () => {
    expect(daysUntil(local(2026, 9, 24), NOW)).toBe(-1);
  });
});

describe("formatEarningsDateLocal", () => {
  it("reads as weekday, month, day, then 'your time'", () => {
    expect(formatEarningsDateLocal(local(2026, 9, 28))).toBe("Wed, Oct 28 your time");
  });
});

describe("earningsChipText", () => {
  const info = (nextMs: number | null, confirmed = true): EarningsInfo => ({ nextMs, confirmed, source: "yahoo" });

  it("counts down in plain words for a future date", () => {
    expect(earningsChipText(info(local(2026, 9, 28)), NOW)).toBe("Earnings in 3 days · Wed, Oct 28 your time");
  });

  it("says 'today' at zero days, not 'in 0 days'", () => {
    expect(earningsChipText(info(local(2026, 9, 25, 20)), NOW)).toBe("Earnings today · Sun, Oct 25 your time");
  });

  it("says 'tomorrow' at one day, not 'in 1 days'", () => {
    expect(earningsChipText(info(local(2026, 9, 26)), NOW)).toBe("Earnings tomorrow · Mon, Oct 26 your time");
  });

  it("reads as not-announced when no source has a date", () => {
    expect(earningsChipText(info(null), NOW)).toBe("Earnings date not announced yet");
  });

  it("reads as not-announced when info itself is missing (loading / unknown ticker)", () => {
    expect(earningsChipText(undefined, NOW)).toBe("Earnings date not announced yet");
  });

  it("never shows a countdown for a stale date that's already passed", () => {
    // A source can go stale between cache refreshes; showing "Earnings in -2 days" would be a
    // lie about the future, so a passed date reads the same as no date at all.
    expect(earningsChipText(info(local(2026, 9, 23)), NOW)).toBe("Earnings date not announced yet");
  });
});
