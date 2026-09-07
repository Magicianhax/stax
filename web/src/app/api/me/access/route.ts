// GET /api/me/access — the signed-in user's private-beta standing (docs/BETA.md).
//   → Access { beta, status, position, waiting, refCode, referrals, referralUrl, joinedAt }
// `beta` mirrors NEXT_PUBLIC_PRIVATE_BETA; `status: 'none'` = not on the list. Never cached.
import type { NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";
import { getAccess } from "@/lib/server/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = await rateLimit(`me-access:${user.userId}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const access = await getAccess(user.userId);
    return Response.json(access, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("me-access", err);
  }
}
