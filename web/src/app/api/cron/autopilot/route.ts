import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { CHAIN_KEYS, getChain, type ChainKey } from "@/lib/chains";
import { syncExecutorEvents } from "@/lib/server/indexer";
import { CADENCE_SECONDS, type AutopilotConfig } from "@/lib/autopilot";
import { claimDueAutopilots, releaseAutopilot } from "@/lib/server/autopilotStore";
import { runAutopilot } from "@/lib/server/autopilotExecutor";

// Scheduled, autonomous runs — never cache. Allow up to 5 min for a batch.
// Every due config is claimed atomically (claimed_at stamped), then grouped by
// chain: chains run in parallel, configs within a chain sequentially (one
// bundler queue per chain). Each claim is released — claimed_at cleared,
// next_run_at advanced — whether the run succeeded or failed.
// (No per-chain filter: the claim is atomic and global, so filtering after it
// would leave claimed rows stuck until the 30-minute claim TTL.)
// Invoked by Vercel Cron (vercel.json) — daily on Hobby, hourly on Pro.
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

type RunRow = { id: string; chain: ChainKey; ok: boolean; txHash?: string; reason?: string };

async function runGroup(cfgs: AutopilotConfig[], now: number): Promise<RunRow[]> {
  const rows: RunRow[] = [];
  for (const cfg of cfgs) {
    try {
      const r = await runAutopilot(cfg, { nowSeconds: now });
      rows.push({ id: cfg.id, chain: cfg.chain, ...r });
    } catch (e) {
      rows.push({ id: cfg.id, chain: cfg.chain, ok: false, reason: e instanceof Error ? e.message : "run failed" });
    } finally {
      try {
        await releaseAutopilot(cfg.id, nextSlotAfter(cfg, now));
      } catch (e) {
        // Left claimed: the 30-minute claim TTL lets the next cron pick it up.
        console.error("[autopilot] release failed:", cfg.id, e instanceof Error ? e.message : e);
      }
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
