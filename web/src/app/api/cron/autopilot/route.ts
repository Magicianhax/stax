import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { CHAIN_KEYS, getChain, type ChainKey } from "@/lib/chains";
import { syncExecutorEvents } from "@/lib/server/indexer";
import { CADENCE_SECONDS, type AutopilotConfig } from "@/lib/autopilot";
import { claimDueAutopilots, releaseAutopilot } from "@/lib/server/autopilotStore";
import { runAutopilot } from "@/lib/server/autopilotExecutor";
import { isPermanent } from "@/lib/autopilotRetry";

// Binance's Web3 API refuses US traffic ("40304: Service not available due to compliance
// restriction"), and Vercel runs functions in Washington DC by default, so every route that
// reaches Binance runs in Frankfurt. The database is in us-east-1: one extra ocean crossing.
export const preferredRegion = "fra1";

// Scheduled, autonomous runs — never cache. Allow up to 5 min for a batch.
// Every due config is claimed atomically (claimed_at stamped), then grouped by
// chain: chains run in parallel, configs within a chain sequentially (one
// bundler queue per chain). Each claim is released — claimed_at cleared,
// next_run_at advanced — whether the run succeeded or failed.
// (No per-chain filter: the claim is atomic and global, so filtering after it
// would leave claimed rows stuck until the 30-minute claim TTL.)
// Invoked by Vercel Cron (vercel.json) — daily on Hobby, hourly on Pro. The Hobby schedule is
// 15:00 UTC: 11:00 New York in summer (EDT, UTC-4) and 10:00 in winter (EST, UTC-5), so the one
// daily tick always lands after the 9:30 ET open — a BSC stock-leg rule (buy_discount, rebalance,
// safety_switch, mix_keeper) that only wants to trade while the real market is open would
// otherwise be skipped every single day by a cron that fires before 9:30 ET on the Hobby plan's
// one-run-a-day budget. Crypto legs don't care (they trade any time), and Base/Mantle's own
// goal/basket runs don't either — this only matters once BSC rules start evaluating for real.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Auth: a shared secret in the Authorization header ONLY (Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>`). No URL-borne secret — query strings
// leak into access logs/proxies. Compared in constant time. Either
// AUTOPILOT_CRON_SECRET or CRON_SECRET (the name Vercel injects) is accepted.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(bearer);
  return [process.env.AUTOPILOT_CRON_SECRET, process.env.CRON_SECRET].some((secret) => {
    if (!secret) return false;
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/**
 * Next slot on the config's own cadence grid, strictly after `now`. Keeps the
 * user's anchor time; if the cron ran late (daily cron, overdue row) it skips
 * the missed slots instead of piling up catch-up runs.
 */
function nextSlotAfter(cfg: AutopilotConfig, now: number): number {
  const step = CADENCE_SECONDS[cfg.cadence];
  let next = cfg.nextRunAt + step;
  while (next <= now) next += step;
  return next;
}

type RunRow = { id: string; chain: ChainKey; ok: boolean; txHash?: string; reason?: string; attempts?: number; retryable?: boolean };

/** Retry a failed run this many extra times inside the same invocation. */
const RETRY_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = [4000, 12_000];
/** When a run failed for a passing reason, come back this soon rather than next slot. */
const RETRY_SOON_SECONDS = 15 * 60;

async function runGroup(cfgs: AutopilotConfig[], now: number): Promise<RunRow[]> {
  const rows: RunRow[] = [];
  for (const cfg of cfgs) {
    let row: RunRow = { id: cfg.id, chain: cfg.chain, ok: false, reason: "run failed" };
    let attempts = 0;
    // A failed run used to advance straight to the next slot, so a weekly plan
    // that hit a bad minute simply skipped the week, silently. Try again here,
    // then leave it due again shortly rather than a whole cadence away.
    for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
      attempts = attempt + 1;
      try {
        const r = await runAutopilot(cfg, { nowSeconds: Math.floor(Date.now() / 1000) });
        row = { id: cfg.id, chain: cfg.chain, ...r };
      } catch (e) {
        row = { id: cfg.id, chain: cfg.chain, ok: false, reason: e instanceof Error ? e.message : "run failed" };
      }
      // `retryable === false` (runAutopilot's own call, e.g. "not deployed yet", "waiting on
      // holdings", over the risk ceiling) is a decided, honest skip, not a transient fault —
      // retrying it 2 more times just burns the shared 300s budget and repeats the same log
      // row for nothing (review finding #4). `isPermanent`'s text match still covers reasons
      // that never carried the flag (basket-store errors, signer faults, etc).
      if (row.ok || isPermanent(row.reason) || row.retryable === false) break;
      if (attempt < RETRY_ATTEMPTS) {
        console.warn(`[autopilot] ${cfg.id} attempt ${attempts} failed: ${row.reason} — retrying`);
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 4000));
      }
    }
    rows.push({ ...row, attempts });

    try {
      // Transient failure ⇒ due again soon, never later than the next slot, so a
      // more frequent cron picks it up and a daily one behaves exactly as before.
      const slot = nextSlotAfter(cfg, now);
      const soon = Math.floor(Date.now() / 1000) + RETRY_SOON_SECONDS;
      const next = row.ok || isPermanent(row.reason) || row.retryable === false ? slot : Math.min(soon, slot);
      await releaseAutopilot(cfg.id, next);
    } catch (e) {
      // Left claimed: the 30-minute claim TTL lets the next cron pick it up.
      console.error("[autopilot] release failed:", cfg.id, e instanceof Error ? e.message : e);
    }
  }
  return rows;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  // Keep the executor index fresh on every tick, even with nothing due (never throws).
  await Promise.all(CHAIN_KEYS.map((k) => syncExecutorEvents(getChain(k))));
  const now = Math.floor(Date.now() / 1000);
  const due = await claimDueAutopilots(now);

  const byChain = new Map<ChainKey, AutopilotConfig[]>();
  for (const cfg of due) {
    const list = byChain.get(cfg.chain) ?? [];
    list.push(cfg);
    byChain.set(cfg.chain, list);
  }

  const groups = await Promise.all([...byChain.values()].map((cfgs) => runGroup(cfgs, now)));
  const results = groups.flat();

  return Response.json({
    checkedAt: now,
    chains: [...byChain.keys()],
    due: due.length,
    ran: results.length,
    results,
  });
}
