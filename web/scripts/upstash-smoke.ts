// Upstash smoke test — exercises rateLimit() and cached() against the REAL Redis.
//   npm run upstash:smoke   (= tsx --conditions=react-server --env-file=.env.local scripts/upstash-smoke.ts)
// Needs Redis credentials in .env.local (or the shell): UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN, or Vercel's KV_REST_API_URL + KV_REST_API_TOKEN.
// `--conditions=react-server` makes the `server-only` guard a no-op so the app's own
// modules can run outside Next. Keys it creates are deleted / expire within a minute.
import { Redis } from "@upstash/redis";
import { cacheDel, cached } from "../src/lib/server/cache";
import { rateLimit } from "../src/lib/server/rateLimit";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  assert(url && token, "No Redis credentials: set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN");
  const redis = new Redis({ url, token, automaticDeserialization: false });
  const ping = await redis.ping();
  console.log("ping:", ping);

  // ── rateLimit: 5 per 10 s sliding window ──────────────────────────────────
  const key = `smoke:${Date.now()}`;
  const results: boolean[] = [];
  for (let i = 0; i < 7; i++) results.push((await rateLimit(key, 5, 10_000)).ok);
  console.log("rateLimit 7 hits @ 5/10s:", results.map((ok) => (ok ? "ok" : "429")).join(" "));
  assert(results.slice(0, 5).every(Boolean), "first 5 hits should pass");
  assert(!results[5] && !results[6], "hits 6 and 7 should be blocked");
  const blocked = await rateLimit(key, 5, 10_000);
  assert(blocked.retryAfter >= 1 && blocked.retryAfter <= 10, `retryAfter in 1..10 (got ${blocked.retryAfter})`);
  console.log("rateLimit retryAfter:", blocked.retryAfter, "s");
  const rlKeys = await redis.keys("stax:rl:*smoke:*");
  assert(rlKeys.length > 0, "expected a stax:rl:* key in Redis");
  console.log("rateLimit redis keys:", rlKeys);
  if (rlKeys.length) await redis.del(...rlKeys);

  // ── cached: miss → set with TTL, hit, single-flight, del ──────────────────
  const ckey = `smoke:${Date.now()}`;
  let loads = 0;
  const load = async () => {
    loads++;
    await new Promise((r) => setTimeout(r, 50));
    return { n: 42, at: new Date().toISOString(), nested: { ok: true, list: [1, 2, 3] } };
  };
  const [a, b, c] = await Promise.all([cached(ckey, 30, load), cached(ckey, 30, load), cached(ckey, 30, load)]);
  assert(loads === 1, `single-flight: loader ran ${loads}x for a 3-wide burst`);
  assert(a.n === 42 && b.n === 42 && c.n === 42, "burst results match");
  const ttl = await redis.ttl(`stax:cache:${ckey}`);
  assert(ttl > 0 && ttl <= 30, `TTL should be 1..30 s (got ${ttl})`);
  console.log("cached miss + burst: loads =", loads, "ttl =", ttl, "s");
  const hit = await cached(ckey, 30, load);
  assert(loads === 1 && hit.at === a.at, "second call should be a Redis hit");
  console.log("cached hit: value round-tripped from Redis:", JSON.stringify(hit));

  // A cached null must be a hit (not re-loaded).
  const nkey = `smoke:null:${Date.now()}`;
  let nullLoads = 0;
  const loadNull = async () => {
    nullLoads++;
    return null;
  };
  await cached<null>(nkey, 30, loadNull);
  await cached<null>(nkey, 30, loadNull);
  assert(nullLoads === 1, `null should be cached (loader ran ${nullLoads}x)`);
  console.log("cached null: hit on second call");

  // bigint is rejected with a clear error, and not cached.
  let threw = "";
  try {
    await cached(`smoke:bigint:${Date.now()}`, 30, async () => ({ raw: BigInt(1) }));
  } catch (err) {
    threw = err instanceof Error ? err.message : String(err);
  }
  assert(/bigint/i.test(threw), `bigint should throw a clear error (got: ${threw})`);
  console.log("cached bigint: rejected ->", threw);

  await cacheDel(ckey);
  await cacheDel(nkey);
  assert((await redis.exists(`stax:cache:${ckey}`)) === 0, "cacheDel should remove the key");
  console.log("cacheDel: removed");

  console.log("\nAll Upstash smoke checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
