import type { NextRequest } from "next/server";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { getAutopilot } from "@/lib/server/autopilotStore";
import { runAutopilot } from "@/lib/server/autopilotExecutor";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Binance's Web3 API refuses US traffic ("40304: Service not available due to compliance
// restriction"), and Vercel runs functions in Washington DC by default, so every route that
// reaches Binance runs in Frankfurt. The database is in us-east-1: one extra ocean crossing.
export const preferredRegion = "fra1";

// Triggers the caller's own autopilot once, now. Signs + submits a real invest —
// never cache; allow time for bundler inclusion.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  // Private beta: only approved users may spend (no-op while NEXT_PUBLIC_PRIVATE_BETA is off).
  const gate = await requireApproved(user);
  if (gate) return gate;

  // Tight cap — each call signs and submits an on-chain UserOp.
  const limit = await rateLimit(`autopilot-run:${user.userId}`, 6, 60_000);
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
