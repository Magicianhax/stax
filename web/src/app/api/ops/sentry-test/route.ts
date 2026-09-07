// GET /api/ops/sentry-test — raises one deliberate error so monitoring can be
// verified end to end after a deploy. Guarded by the cron bearer secret, never
// linked from the UI, no side effects. `mode=throw` leaves the error unhandled
// (exercises Sentry's request-error hook); the default goes through the shared
// `serverError` helper (exercises the explicit capture path).
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverError, jsonError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!bearer) return false;
  return [process.env.AUTOPILOT_CRON_SECRET, process.env.CRON_SECRET].some((secret) => {
    if (!secret || secret.length !== bearer.length) return false;
    return timingSafeEqual(Buffer.from(secret), Buffer.from(bearer));
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return jsonError(401, "Unauthorized.");
  const mode = req.nextUrl.searchParams.get("mode") ?? "handled";
  const err = new Error(`Sentry test event (${mode}) at ${new Date().toISOString()}`);
  if (mode === "throw") throw err;
  return serverError("ops.sentry-test", err);
}
