// Client-safe shapes and copy for the earnings-calendar feature (brief idea 6: "Vera can buy
// before earnings and sell after"). lib/server/earnings.ts is the only place that fetches a
// date; everything here is pure, so EarningsChip and a future Autopilot rule evaluator can both
// read it without pulling a server-only module into a client bundle.
//
// `nextMs`/`confirmed` are never guessed. `confirmed: true` means the source itself reports an
// announced date (Yahoo Finance's own `isEarningsDateEstimate === false`); `confirmed: false`
// means it's the source's own estimate of when the next report will land, not Stax's. `nextMs:
// null` means no keyless source had anything at all for this ticker — that's a normal, common
// outcome (private/pre-IPO tickers, a source outage), not an error.
export interface EarningsInfo {
  /** Epoch ms of the next earnings report, or null when nothing was found. */
  nextMs: number | null;
  /** True when the source calls this an announced date rather than its own estimate. */
  confirmed: boolean;
  /** Where this came from ("yahoo", or "unavailable" when nextMs is null), for debugging. */
  source: string;
}

/** `GET /api/earnings?chain=bsc` shape: one entry per ticker Stax tried to look up. */
export type EarningsMap = Record<string, EarningsInfo>;

/** Local midnight for `ms`, in the runtime's own time zone — the unit `daysUntil` counts in. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole calendar days from `nowMs` to `targetMs`, counted in the caller's own local time zone
 * (not raw ms / 86.4M, which would round the wrong way across a day boundary that isn't exactly
 * 24h from `nowMs` — e.g. a report at 4am tomorrow is still only "1" day out at 11pm tonight).
 * 0 for later today, negative once `targetMs` has already passed.
 */
export function daysUntil(targetMs: number, nowMs: number): number {
  return Math.round((startOfLocalDay(targetMs) - startOfLocalDay(nowMs)) / MS_PER_DAY);
}

const CHIP_DATE_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * "Wed, Oct 28" — the one place an earnings instant becomes a calendar date. No explicit
 * `timeZone` (same trick as marketHours.ts's `formatOpensLocal`): `Intl` resolves to the runtime's
 * own zone, so a viewer far from US market hours sees the date THEIR calendar would call it. No
 * "your time" suffix: that belongs on a clock time, and on a bare date it only read as noise
 * (design critique P2 #15).
 */
export function formatEarningsDateLocal(nextMs: number): string {
  return CHIP_DATE_FMT.format(new Date(nextMs));
}

const NOT_ANNOUNCED = "Next results date not announced yet";

/**
 * The one sentence EarningsChip shows for a company: "Nvidia reports results in 33 days · Wed,
 * Oct 28". A stale date that has already passed reads exactly like "no date at all" rather than
 * a countdown gone negative — the cache missed a refresh, that's not the user's problem to parse.
 */
export function earningsChipText(
  info: EarningsInfo | null | undefined,
  nowMs: number = Date.now(),
  companyName = "This company",
): string {
  if (!info || info.nextMs === null) return NOT_ANNOUNCED;
  const days = daysUntil(info.nextMs, nowMs);
  if (days < 0) return NOT_ANNOUNCED;
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return `${companyName} reports results ${when} · ${formatEarningsDateLocal(info.nextMs)}`;
}
