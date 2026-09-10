// GET /api/me/access — the signed-in user's private-beta standing (docs/BETA.md).
//   → Access { beta, status, position, waiting, refCode, referrals, referralUrl, joinedAt }
// `beta` mirrors NEXT_PUBLIC_PRIVATE_BETA; `status: 'none'` = not on the list. Never cached.
import type { NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";
import { admitGiftRecipient, getAccess } from "@/lib/server/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = await rateLimit(`me-access:${user.userId}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    // Someone who was sent a gift should never meet the waitlist. Cheap when there is
    // nothing waiting, and best-effort: a failure here must not blank the gate.
    let access = await getAccess(user.userId);
    if (access.beta && access.status === "waiting") {
      try {
        if (await admitGiftRecipient(user.userId)) access = await getAccess(user.userId);
      } catch (e) {
        console.warn("[access] gift admission check failed:", e instanceof Error ? e.message : e);
      }
    }
    return Response.json(access, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("me-access", err);
  }
}
