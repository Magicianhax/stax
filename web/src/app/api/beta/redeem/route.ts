// POST /api/beta/redeem — spend an invite code and skip the queue (docs/BETA.md).
//   body { code }  →  Access
//
// Requires a signed-in user, because approval is granted to an account, not to
// whoever is holding the code. Rate limited harder than the rest of the beta API:
// a code is ten characters from a thirty-one letter alphabet, and guessing is the
// only attack there is.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { INVITE_BAD_CODE, INVITE_EXPIRED, INVITE_SPENT } from "@/lib/beta";
import { redeemCode } from "@/lib/server/inviteCodes";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ code: z.string().trim().min(1).max(32) });

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = await rateLimit(`beta-redeem:${user.userId}`, 10, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const result = await redeemCode(user.userId, body.code);
    if (!result.ok) {
      const message =
        result.reason === "spent" ? INVITE_SPENT : result.reason === "expired" ? INVITE_EXPIRED : INVITE_BAD_CODE;
      return badRequest(message);
    }
    return Response.json(result.access, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("beta-redeem", err);
  }
}
