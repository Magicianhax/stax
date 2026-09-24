import "server-only";

import { BinanceWeb3Error } from "./types";

// Binance's budget on this key is 5 calls per window (X-OC-RateLimit-Limit: 5), and Review
// Focus #4 says a 429/418 on leg 3 of 4 must back off and retry, never half-execute a basket
// silently. So every call funnels through one process-wide queue: calls run one at a time, a
// 429/418 waits and retries in place (1s, 2s, 4s, then gives up), and a call that used the
// window's last slot (X-OC-RateLimit-Remaining: 0) makes the next call in line wait a second
// before it even starts, rather than let it draw the same 429.
const RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(fn: () => Promise<Response>, attempt: number): Promise<Response> {
  const res = await fn();
  if (res.status === 429 || res.status === 418) {
    if (attempt >= RETRY_DELAYS_MS.length) throw new BinanceWeb3Error(429, "rate limited", 429);
    await sleep(RETRY_DELAYS_MS[attempt]);
    return runWithRetry(fn, attempt + 1);
  }
  if (res.headers.get("X-OC-RateLimit-Remaining") === "0") await sleep(1000);
  return res;
}

// The chain itself is the queue: each call's promise starts only once the one ahead of it has
// settled, and a rejection is swallowed here (not on the caller's promise) so one failed call
// never wedges every call queued behind it.
let queue: Promise<unknown> = Promise.resolve();

export function limited(fn: () => Promise<Response>): Promise<Response> {
  const run = queue.then(() => runWithRetry(fn, 0));
  queue = run.catch(() => undefined);
  return run;
}
