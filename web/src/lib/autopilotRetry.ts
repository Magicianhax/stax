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

/**
 * Did a failed `sendUserOperation` maybe reach the bundler anyway?
 *
 * "Failed" and "unknown" are different outcomes and must not share a retry. A send that the
 * bundler answered with an error (an AA code, a paymaster refusal, any JSON-RPC error) was never
 * accepted, so trying again is safe. A send whose `eth_sendUserOperation` request timed out or
 * lost its connection may have been accepted and may land: retrying it builds a fresh op for the
 * next nonce once the first lands, and Autopilot buys twice in one period.
 *
 * Shape (viem 2.x): only the `eth_sendUserOperation` request itself is wrapped in a
 * `UserOperationExecutionError` (gas estimation and paymaster calls throw their own errors), and
 * a transport fault sits in its cause chain as a `TimeoutError`, or an `HttpRequestError` with no
 * status (the connection dropped) or a 504 (a proxy gave up waiting on the bundler). Matched by
 * `name` so this stays dependency-free.
 */
export function sendOutcomeUnknown(err: unknown): boolean {
  let atSend = false;
  let transportFault = false;
  let e: unknown = err;
  for (let depth = 0; e && typeof e === "object" && depth < 10; depth++) {
    const { name, status, cause } = e as { name?: unknown; status?: unknown; cause?: unknown };
    if (name === "UserOperationExecutionError") atSend = true;
    if (name === "TimeoutError") transportFault = true;
    if (name === "HttpRequestError" && (status === undefined || status === 504)) transportFault = true;
    e = cause;
  }
  return atSend && transportFault;
}
