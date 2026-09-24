// NOT wired into vercel.json: this project is on Vercel Hobby, which only allows a daily cron
// (see app/api/cron/autopilot's own comment), so a 15-minute entry here would fail every deploy.
// GET /api/rwa/spread now records the 15-minute snapshot itself, opportunistically, on whichever
// request wins a Redis tick claim (see that route's header) — that's the primary path and needs
// no scheduler at all. This route stays as a second path for the same job: an external scheduler
// (e.g. a GitHub Actions `schedule: */15` job) can call it with the bearer secret below. Setting
// that secret is a human-gated step; nothing calls this route until a human wires one up.
//
// Takes ONE bscCatalogSnapshot — the same cached read /api/rwa already serves, so this spends no
// Binance calls of its own — and records each ticker's per-venue price against the real share
// into Redis (lib/server/spreadStore.ts), so /api/rwa/spread/[ticker] has a history to chart.
// Never invents a point: a Binance outage means this tick records nothing, not a guess.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { bscCatalogSnapshot } from "@/lib/server/rwaCatalog";
import { recordCatalogSnapshot } from "@/lib/server/spreadStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Auth: a shared secret in the Authorization header ONLY, same shape as app/api/cron/autopilot
// (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`). Either SPREAD_CRON_SECRET or
// CRON_SECRET (the name Vercel injects) is accepted, compared in constant time.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(bearer);
  return [process.env.SPREAD_CRON_SECRET, process.env.CRON_SECRET].some((secret) => {
    if (!secret) return false;
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const nowMs = Date.now();
  const { tickers, asOf } = await bscCatalogSnapshot(nowMs);
  const { venuesRecorded } = await recordCatalogSnapshot("bsc", tickers, nowMs);

  return Response.json({ checkedAt: nowMs, catalogAsOf: asOf, tickers: tickers.length, venuesRecorded });
}
