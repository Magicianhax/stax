// When a scheduled run fails, is it worth trying again?
//
// This used to be moot: any failure advanced the plan straight to its next slot,
// so a weekly plan that hit a bad minute silently skipped the week. Now a run is
// retried in place, which makes the distinction below load-bearing — retrying a
// plan the person has to fix just burns the gas allowance and fills the audit
// log with noise.
//
// Pure and dependency-free so it can be tested without a database.

/** Reasons that will not improve on their own. */
const PERMANENT = [
  "ceiling", // risk above the limit they set
  "no longer exists", // the basket was deleted
  "not authorized",
  "not delegated",
  "insufficient",
  "not enough",
  "paused",
  "cap", // per-period spend cap reached
];

export function isPermanent(reason: string | undefined): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return PERMANENT.some((p) => r.includes(p));
}
