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

// Design critique P2 #15: a calendar date has no "your time" (only a clock time does), and
// "Earnings" is trader shorthand — say who reports what.
describe("formatEarningsDateLocal", () => {
  it("reads as weekday, month, day — no 'your time' on a date", () => {
    expect(formatEarningsDateLocal(local(2026, 9, 28))).toBe("Wed, Oct 28");
  });
});

describe("earningsChipText", () => {
  const info = (nextMs: number | null, confirmed = true): EarningsInfo => ({ nextMs, confirmed, source: "yahoo" });

  it("names the company and counts down in plain words", () => {
    expect(earningsChipText(info(local(2026, 9, 28)), NOW, "Nvidia")).toBe("Nvidia reports results in 3 days · Wed, Oct 28");
  });

  it("says 'today' at zero days, not 'in 0 days'", () => {
    expect(earningsChipText(info(local(2026, 9, 25, 20)), NOW, "Nvidia")).toBe("Nvidia reports results today · Sun, Oct 25");
  });

  it("says 'tomorrow' at one day, not 'in 1 days'", () => {
    expect(earningsChipText(info(local(2026, 9, 26)), NOW, "Nvidia")).toBe("Nvidia reports results tomorrow · Mon, Oct 26");
  });

  it("falls back to 'This company' without a name", () => {
    expect(earningsChipText(info(local(2026, 9, 28)), NOW)).toBe("This company reports results in 3 days · Wed, Oct 28");
  });

  it("reads as not-announced when no source has a date", () => {
    expect(earningsChipText(info(null), NOW, "Nvidia")).toBe("Next results date not announced yet");
  });

  it("reads as not-announced when info itself is missing (loading / unknown ticker)", () => {
    expect(earningsChipText(undefined, NOW)).toBe("Next results date not announced yet");
  });

  it("never shows a countdown for a stale date that's already passed", () => {
    expect(earningsChipText(info(local(2026, 9, 23)), NOW, "Nvidia")).toBe("Next results date not announced yet");
  });
});
