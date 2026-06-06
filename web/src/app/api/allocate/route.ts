import type { NextRequest } from "next/server";
import { AllocateRequestSchema } from "@/lib/allocation-schema";
import { buildAllocation, ALLOCATE_MODEL } from "@/lib/server/allocate";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

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

  // M-5: cap AI calls per user (cost-amplification guard).
  const limit = rateLimit(`allocate:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof AllocateRequestSchema.parse>;
  try {
    body = AllocateRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const allocation = await buildAllocation(body.goal, body.amountUsd, body.riskTolerance);
    return Response.json({
      ...allocation,
      amountUsd: body.amountUsd,
      model: ALLOCATE_MODEL,
    });
  } catch (err) {
    return serverError("allocate", err);
  }
}
