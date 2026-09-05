import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type { ChainKey } from "@/lib/chains";
import type { AutopilotConfig } from "@/lib/autopilot";
import { claimDueAutopilots } from "@/lib/server/autopilotStore";
import { runAutopilot } from "@/lib/server/autopilotExecutor";

// Scheduled, autonomous runs — never cache. Allow up to 5 min for a batch.
// Every due config is claimed atomically, then grouped by chain: chains run in
// parallel, configs within a chain sequentially (one bundler queue per chain).
// (No per-chain filter: the claim is atomic and global, so filtering after it
// would silently skip already-advanced rows.)
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Auth: a shared secret in the Authorization header ONLY (Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>`). No URL-borne secret — query strings
// leak into access logs/proxies. Compared in constant time. Set
// AUTOPILOT_CRON_SECRET (and, on Vercel, CRON_SECRET) to the same value.
function authorized(req: NextRequest): boolean {
  const secret = process.env.AUTOPILOT_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
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
    }
  }
  return rows;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

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
