import "server-only";
import { Redis } from "@upstash/redis";

// Redis-backed history for the price-vs-real-share board: per ticker + issuer, a capped series
// of snapshots the cron appends to (app/api/cron/spread) and the ticker API reads back
// (app/api/rwa/spread/[ticker]). Same degrade-to-per-process-memory shape as lib/server/cache.ts
// and lib/server/rateLimit.ts, and the same reasoning for it: a hackathon demo can't depend on
// Redis being configured in every environment it runs in, and a Redis outage here should mean
// "the chart is thin today", never a 500 on the board or the cron.
//
// Snapshots are only ever taken from a real bscCatalogSnapshot() read (Task 9's live catalog) —
// this file never invents a point, so an empty history is an honest "nothing recorded yet", not
// a placeholder.
import type { RwaPlatform } from "@/lib/chains";
import type { RwaTickerView } from "@/lib/rwa";
import { SPREAD_HISTORY_DAYS, SPREAD_SNAPSHOT_SPACING_MINUTES, type SpreadPoint } from "@/lib/spread";
import { redisCredentials } from "./cache";

const KEY_PREFIX = "stax:spread:history:";
const TICK_KEY_PREFIX = "stax:spread:tick:";
const MAX_AGE_MS = SPREAD_HISTORY_DAYS * 24 * 60 * 60 * 1000;
const SPACING_MS = SPREAD_SNAPSHOT_SPACING_MINUTES * 60 * 1000;
// A hard backstop above the exact "history days / spacing" count, so a cron that ticks a little
// early once in a while can never let the array creep past a sane bound even before the next
// age-based trim catches up.
const MAX_POINTS = Math.ceil(MAX_AGE_MS / SPACING_MS) + 8;

function keyFor(chainKey: string, ticker: string, platform: RwaPlatform): string {
  return `${KEY_PREFIX}${chainKey}:${ticker}:${platform}`;
}

let redis: Redis | null | undefined; // undefined = not yet resolved, null = env unset
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const creds = redisCredentials();
  redis = creds ? new Redis({ url: creds.url, token: creds.token, automaticDeserialization: false }) : null;
  return redis;
}

let lastWarnAt = 0;
function warnOncePerMinute(op: string, err: unknown) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn(`[spreadStore] Upstash ${op} failed:`, err instanceof Error ? err.message : err);
}

// ── in-memory fallback ───────────────────────────────────────────────────────
const memory = new Map<string, SpreadPoint[]>();
// chainKey -> the nowMs at/after which the next tick may be claimed.
const memoryTickClaims = new Map<string, number>();

/**
 * Claims one snapshot tick for `chainKey`, at most once per `windowMs` (see app/api/rwa/spread's
 * header for why this exists instead of a dedicated cron: Vercel Hobby only allows a daily cron,
 * so the board's own GET claims a 15-minute tick and records the catalog snapshot it already has
 * in hand). Backed by Redis `SET key val NX EX` so every instance and region shares one claim;
 * the memory fallback compares against the passed `nowMs` rather than the wall clock so it's
 * deterministic in tests and degrades the same way `cache.ts`/`rateLimit.ts` do without Redis
 * configured. A Redis error fails OPEN (claims true) — the follow-up write into `readPoints` /
 * `writePoints` hits the same outage and warns once a minute on its own; refusing the claim here
 * too would just mean the tick is silently skipped instead.
 */
export async function claimSpreadTick(chainKey: string, nowMs: number, windowMs: number): Promise<boolean> {
  const key = `${TICK_KEY_PREFIX}${chainKey}`;
  const r = getRedis();
  if (!r) {
    const next = memoryTickClaims.get(key) ?? 0;
    if (nowMs < next) return false;
    memoryTickClaims.set(key, nowMs + windowMs);
    return true;
  }
  try {
    const ok = await r.set(key, String(nowMs), { nx: true, ex: Math.max(1, Math.ceil(windowMs / 1000)) });
    return ok === "OK";
  } catch (err) {
    warnOncePerMinute("SET NX", err);
    return true;
  }
}

async function readPoints(key: string): Promise<SpreadPoint[]> {
  const r = getRedis();
  if (!r) return memory.get(key) ?? [];
  try {
    const raw = await r.get<string>(key);
    return raw ? (JSON.parse(raw) as SpreadPoint[]) : [];
  } catch (err) {
    warnOncePerMinute("GET", err);
    return [];
  }
}

async function writePoints(key: string, points: SpreadPoint[]): Promise<void> {
  const r = getRedis();
  if (!r) {
    memory.set(key, points);
    return;
  }
  try {
    await r.set(key, JSON.stringify(points));
  } catch (err) {
    warnOncePerMinute("SET", err);
  }
}

/**
 * Folds one new point into a kept history: drop anything older than `SPREAD_HISTORY_DAYS`
 * (relative to the new point's own time, so a batch of points from one snapshot all trim the
 * same way), then either append the point or — when it lands inside the same spacing window as
 * the last kept point — replace that last point. That second rule is what keeps a cron that
 * ticks more often than the spacing (or a retried run) from piling up two points a minute
 * apart; `MAX_POINTS` is a hard ceiling behind it.
 */
export function foldSpreadPoint(existing: readonly SpreadPoint[], next: SpreadPoint): SpreadPoint[] {
  const cutoff = next.t - MAX_AGE_MS;
  const kept = existing.filter((p) => p.t >= cutoff).slice();
  const last = kept[kept.length - 1];
  if (last && next.t - last.t < SPACING_MS) {
    kept[kept.length - 1] = next;
  } else {
    kept.push(next);
  }
  if (kept.length > MAX_POINTS) kept.splice(0, kept.length - MAX_POINTS);
  return kept;
}

/** Appends one ticker + issuer's snapshot to its history, trimmed. Called only from the cron. */
export async function recordSpreadPoint(
  chainKey: string,
  ticker: string,
  platform: RwaPlatform,
  point: SpreadPoint,
): Promise<void> {
  const key = keyFor(chainKey, ticker, platform);
  const existing = await readPoints(key);
  await writePoints(key, foldSpreadPoint(existing, point));
}

/** One ticker's kept history for each requested platform; a platform with no points is left out. */
export async function getSpreadHistory(
  chainKey: string,
  ticker: string,
  platforms: readonly RwaPlatform[],
): Promise<{ platform: RwaPlatform; points: SpreadPoint[] }[]> {
  const out: { platform: RwaPlatform; points: SpreadPoint[] }[] = [];
  for (const platform of platforms) {
    const points = await readPoints(keyFor(chainKey, ticker, platform));
    if (points.length > 0) out.push({ platform, points });
  }
  return out;
}

/**
 * One cron tick: records every venue of every ticker in a already-fetched catalog snapshot.
 * Takes no Binance call of its own — the caller passes the same `bscCatalogSnapshot()` result
 * `/api/rwa` already reads, so a spread-history tick never spends the 5-per-window Binance
 * budget on its own. Recorded in parallel (independent Redis keys), so one slow write can't
 * hold up the other 80-odd.
 */
export async function recordCatalogSnapshot(
  chainKey: string,
  tickers: readonly RwaTickerView[],
  nowMs: number,
): Promise<{ venuesRecorded: number }> {
  const writes = tickers.flatMap((t) =>
    t.venues.map((v) =>
      recordSpreadPoint(chainKey, t.ticker, v.platform, {
        t: nowMs,
        tokenPrice: v.tokenPrice,
        referencePrice: v.referencePrice,
        gapPct: v.gapPct,
        buyable: v.buyable,
        state: v.state,
      }),
    ),
  );
  await Promise.all(writes);
  return { venuesRecorded: writes.length };
}
