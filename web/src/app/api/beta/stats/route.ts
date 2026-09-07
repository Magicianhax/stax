// GET /api/beta/stats — public counts for the landing / beta page (docs/BETA.md).
//   → { waiting, approved, total }   Cache-Control: s-maxage=60
import type { NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { serverError, tooManyRequests } from "@/lib/server/respond";
import { getStats } from "@/lib/server/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`beta-stats:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const stats = await getStats();
    return Response.json(stats, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    return serverError("beta-stats", err);
  }
}
