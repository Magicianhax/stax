import type { NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { getAutopilot } from "@/lib/server/autopilotStore";
import { runAutopilot } from "@/lib/server/autopilotExecutor";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Triggers the caller's own autopilot once, now. Signs + submits a real invest —
// never cache; allow time for bundler inclusion.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // Tight cap — each call signs and submits an on-chain UserOp.
  const limit = rateLimit(`autopilot-run:${user.userId}`, 6, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const cfg = await getAutopilot(user.userId);
  if (!cfg) return badRequest("No autopilot is configured.");

  try {
    const result = await runAutopilot(cfg, { manual: true, nowSeconds: Math.floor(Date.now() / 1000) });
    return Response.json(result);
  } catch (err) {
    return serverError("autopilot-run", err);
  }
}
