import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { waitUntil } from "@vercel/functions";
import { redisCredentials } from "@/lib/server/cache";

// Rate limiter. With Redis credentials set (UPSTASH_REDIS_REST_* or Vercel's
// KV_REST_API_*, the same Upstash database) it is a
// sliding window shared across every instance and region (Upstash Redis via
// @upstash/ratelimit). Without them it falls back to the per-process fixed
// window below, which protects a single instance only. Redis errors fail OPEN:
// the request is allowed and a warning is logged at most once a minute, so a
// Redis outage can never 500 the app.

export interface RateResult {
  ok: boolean;
  retryAfter: number; // seconds until the window resets (0 when ok)
}

// ── in-memory fixed window (fallback) ────────────────────────────────────────
interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
let calls = 0;

/** Drop expired windows occasionally so the map can't grow without bound. */
function sweep(now: number) {
  if (++calls % 500 !== 0) return;
  for (const [key, w] of buckets) {
    if (now >= w.resetAt) buckets.delete(key);
  }
}

function memoryRateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  sweep(now);
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (w.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  w.count += 1;
  return { ok: true, retryAfter: 0 };
}

// ── Upstash sliding window ───────────────────────────────────────────────────
let redis: Redis | null | undefined; // undefined = not yet resolved, null = env unset
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const creds = redisCredentials();
  const url = creds?.url;
  const token = creds?.token;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

// One Ratelimit per (limit, window) pair; the identifier (route:ip/user) is the key.
const limiters = new Map<string, Ratelimit>();
function limiterFor(redisClient: Redis, limit: number, windowMs: number): Ratelimit {
  const id = `${limit}/${windowMs}`;
  let rl = limiters.get(id);
  if (!rl) {
    rl = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      prefix: "stax:rl",
      analytics: false,
      // Blocked identifiers are remembered in-process until their reset, so a
      // client that is already over the limit costs no Redis round trip.
      ephemeralCache: new Map(),
    });
    limiters.set(id, rl);
  }
  return rl;
}

let lastWarnAt = 0;
function warnOncePerMinute(err: unknown) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[rateLimit] Upstash unreachable, failing open:", err instanceof Error ? err.message : err);
}

/**
 * Count one hit against `key`. Allows up to `limit` hits per `windowMs`.
 * Resolves ok=false (with retryAfter) once the limit is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const redisClient = getRedis();
  if (!redisClient) return memoryRateLimit(key, limit, windowMs);
  try {
    const res = await limiterFor(redisClient, limit, windowMs).limit(key);
    // Background work (none with analytics off, but keep the contract): let the
    // instance finish it after the response instead of dropping it.
    waitUntil(res.pending);
    if (res.success) return { ok: true, retryAfter: 0 };
    return { ok: false, retryAfter: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)) };
  } catch (err) {
    warnOncePerMinute(err);
    return { ok: true, retryAfter: 0 };
  }
}

/** Best-effort client IP from proxy headers (Vercel/Next set x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
