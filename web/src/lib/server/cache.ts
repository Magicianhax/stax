import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Redis REST credentials, under either name. Upstash's own dashboard sets
 * `UPSTASH_REDIS_REST_*`; the Vercel Marketplace integration provisions the same
 * Upstash database but exports it as `KV_REST_API_*`. Accepting both means
 * connecting the database through Vercel needs no extra variables.
 */
export function redisCredentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}


// Small response cache for public, non-user-specific data (prices, market
// history). With Redis credentials set (UPSTASH_REDIS_REST_* or Vercel's
// KV_REST_API_* — same Upstash database, different variable names), entries
// live in Upstash Redis (`stax:cache:<key>`, EX = ttl) and are shared across
// every instance; without them they live in a per-process Map with the same
// expiry. Either way one in-flight loader per key per process (single-flight),
// so a burst of requests on a cold key makes one upstream call, not N.
//
// Values are JSON. bigint is NOT supported: JSON.stringify throws on it, and
// silently coercing to a string would change the type the reader gets back.
// Convert to number/string before returning from the loader.
//
// Redis errors never fail a request: a GET error counts as a miss and a SET
// error is dropped (warned at most once a minute).

const PREFIX = "stax:cache:";
const DEBUG = process.env.CACHE_DEBUG === "1";

let redis: Redis | null | undefined; // undefined = not yet resolved, null = env unset
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const creds = redisCredentials();
  const url = creds?.url;
  const token = creds?.token;
  // We do our own JSON so a cached `null` ("null") stays distinct from a miss (nil).
  redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;
  return redis;
}

let lastWarnAt = 0;
function warnOncePerMinute(op: string, err: unknown) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn(`[cache] Upstash ${op} failed:`, err instanceof Error ? err.message : err);
}

function debug(msg: string) {
  if (DEBUG) console.debug(`[cache] ${msg}`);
}

// ── in-memory fallback ───────────────────────────────────────────────────────
const memory = new Map<string, { expiresAt: number; json: string }>();
let ops = 0;

function sweep(now: number) {
  if (++ops % 200 !== 0) return;
  for (const [k, v] of memory) if (now >= v.expiresAt) memory.delete(k);
}

// ── serialisation ────────────────────────────────────────────────────────────
function serialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    if (err instanceof TypeError && /BigInt/i.test(err.message)) {
      throw new TypeError("cache: value contains a bigint; convert it to number/string before caching");
    }
    throw err;
  }
}

// ── storage ops (Redis or memory) ────────────────────────────────────────────
async function readRaw(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r) {
    const now = Date.now();
    sweep(now);
    const hit = memory.get(key);
    if (!hit) return null;
    if (now >= hit.expiresAt) {
      memory.delete(key);
      return null;
    }
    return hit.json;
  }
  try {
    const v = await r.get<string>(PREFIX + key);
    return typeof v === "string" ? v : null;
  } catch (err) {
    warnOncePerMinute("GET", err);
    return null;
  }
}

async function writeRaw(key: string, json: string, ttlSeconds: number): Promise<void> {
  const r = getRedis();
  if (!r) {
    memory.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, json });
    return;
  }
  try {
    await r.set(PREFIX + key, json, { ex: ttlSeconds });
  } catch (err) {
    warnOncePerMinute("SET", err);
  }
}

// ── public surface ───────────────────────────────────────────────────────────
const inflight = new Map<string, Promise<unknown>>();

/**
 * Return the cached value for `key`, or run `fn`, cache its result for
 * `ttlSeconds`, and return it. Concurrent callers for the same key within this
 * process share one `fn` call. `fn` rejections are not cached.
 */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) {
    debug(`join ${key}`);
    return pending as Promise<T>;
  }
  const run = (async () => {
    const raw = await readRaw(key);
    if (raw !== null) {
      debug(`hit ${key}`);
      return JSON.parse(raw) as T;
    }
    debug(`miss ${key}`);
    const value = await fn();
    const json = serialize(value) as string | undefined; // undefined when value is undefined
    if (json !== undefined) await writeRaw(key, json, ttlSeconds);
    return value;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}

/** Drop `key` from the cache (Redis and the process fallback). */
export async function cacheDel(key: string): Promise<void> {
  memory.delete(key);
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(PREFIX + key);
  } catch (err) {
    warnOncePerMinute("DEL", err);
  }
}
