import type { NextRequest } from "next/server";
import { AllocateRequestSchema } from "@/lib/allocation-schema";
import { buildAllocation, ALLOCATE_MODEL, AllocationRefusal } from "@/lib/server/allocate";
import { chainFromRequest } from "@/lib/server/chain";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import type { AllocateResult } from "@/lib/invest-types";

// Binance's Web3 API refuses US traffic ("40304: Service not available due to compliance
// restriction"), and Vercel runs functions in Washington DC by default, so every route that
// reaches Binance runs in Frankfurt. The database is in us-east-1: one extra ocean crossing.
export const preferredRegion = "fra1";

// Uses the Anthropic API + user input — never cache.
export const dynamic = "force-dynamic";

// H-6: surface a missing key at module load (startup) rather than first request.
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[allocate] ANTHROPIC_API_KEY is not set — allocations will fail.");
}

export async function POST(req: NextRequest) {
  // C-2: only a signed-in user can spend Anthropic tokens.
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  // Private beta: only approved users may spend (no-op while NEXT_PUBLIC_PRIVATE_BETA is off).
  const gate = await requireApproved(user);
  if (gate) return gate;

  // M-5: cap AI calls per user (cost-amplification guard).
  const limit = await rateLimit(`allocate:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  // The chain decides the investable universe Vera may allocate across.
  const chain = chainFromRequest(req);

  let body: ReturnType<typeof AllocateRequestSchema.parse>;
  try {
    body = AllocateRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const allocation = await buildAllocation(chain, body.goal, body.amountUsd, body.riskTolerance);
    const result: AllocateResult = {
      ...allocation,
      amountUsd: body.amountUsd,
      model: ALLOCATE_MODEL,
      chain: chain.key,
    };
    return Response.json(result);
  } catch (err) {
    // BSC's own refusals (market closed, can't clear the $6-per-leg floor) are written for
    // the user and belong on a 4xx; anything else is an unexpected fault (Review Focus #1/#3 —
    // these used to fall through to serverError's generic "Something went wrong" 500).
    if (err instanceof AllocationRefusal) return badRequest(err.message);
    return serverError("allocate", err);
  }
}
