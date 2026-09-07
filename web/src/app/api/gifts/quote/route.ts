// POST /api/gifts/quote — what a gift of $X into a basket would buy. Public (the
// giver may still be deciding before they sign in), read-only, 60/min per IP. Same
// allocation shape the plan screen already renders, so the gift preview and the
// invest preview can never disagree.
// → { basket, allocation }
import type { NextRequest } from "next/server";
import { z } from "zod";
import { basketToAllocation, colorFor } from "@/lib/baskets";
import { chainKeyFromRequest } from "@/lib/server/chain";
import { resolveGiftBasket } from "@/lib/server/giftsStore";
import { GIFT_MAX_USD, GIFT_MIN_USD, giftContractFor } from "@/lib/gifts";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  basketId: z.string().min(1).max(64),
  amountUsd: z.number().finite().min(GIFT_MIN_USD).max(GIFT_MAX_USD),
});

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`gifts-quote:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainKeyFromRequest(req);
  if (!giftContractFor(chain)) return jsonError(503, "Gifting isn't switched on for this network yet.");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Pick a basket and an amount of at least $5.");
  }

  try {
    const found = await resolveGiftBasket(chain, body.basketId);
    if (!found.ok) return jsonError(404, found.reason);
    const { basket } = found;
    return Response.json({
      basket: {
        id: basket.id,
        name: basket.name,
        tagline: basket.tagline,
        icon: basket.icon,
        color: basket.color || colorFor(basket.id),
        riskScore: basket.riskScore,
      },
      allocation: basketToAllocation(basket, body.amountUsd),
    });
  } catch (err) {
    return serverError("gifts-quote", err);
  }
}
