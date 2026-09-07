// GET /api/baskets/[id] — a shared basket by short id. Public (the link is the
// secret), cached at the edge for 5 min. The basket is re-validated on read so
// risk and weights always reflect today's registry; a basket whose holdings are
// no longer buyable is reported with the same friendly reason a bad link gets.
import type { NextRequest } from "next/server";
import { isBasketShortId } from "@/lib/baskets";
import { getBasket } from "@/lib/server/basketsStore";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit(`baskets-get:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const { id } = await params;
  if (!isBasketShortId(id)) return badRequest("That link doesn't look like a Stax basket.");

  try {
    const res = await getBasket(id);
    if (!res) return jsonError(404, "That basket isn't here. It may have been removed.");
    if (!res.ok) return jsonError(404, res.reason);
    return Response.json(
      { basket: res.basket },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    return serverError("baskets-get", err);
  }
}
