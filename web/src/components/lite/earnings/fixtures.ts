// Fixture data for previewing EarningsChip without a live GET /api/earnings — not imported by
// app code, only by a throwaway preview route during development (same idiom as
// components/lite/spread/fixtures.ts).
import type { EarningsInfo } from "@/lib/earnings";

// A fixed "now" so the fixtures' day counts ("in 3 days", "tomorrow") read the same on every
// machine instead of drifting with the real clock.
export const FIXTURE_NOW = new Date(2026, 9, 25, 9, 0, 0).getTime();

function local(y: number, m: number, d: number, h = 8): number {
  return new Date(y, m, d, h).getTime();
}

export const FIXTURE_EARNINGS: Record<string, EarningsInfo> = {
  // An announced date a few days out.
  NVDA: { nextMs: local(2026, 9, 28), confirmed: true, source: "yahoo" },
  // Today and tomorrow, the two "in N days" edge cases that get their own words.
  TSLA: { nextMs: local(2026, 9, 25, 20), confirmed: true, source: "yahoo" },
  MSFT: { nextMs: local(2026, 9, 26), confirmed: true, source: "yahoo" },
  // Yahoo's own estimate, not yet an announced date — still worth a countdown, just not a
  // promise; EarningsChip reads it the same as a confirmed one (the countdown), the distinction
  // is for a caller (the rules evaluator) deciding whether to trust it for a real trade.
  AMD: { nextMs: local(2026, 11, 3), confirmed: false, source: "yahoo" },
  // No keyless source had anything — a private/pre-IPO ticker, or a source outage.
  SPCX: { nextMs: null, confirmed: false, source: "unavailable" },
};
