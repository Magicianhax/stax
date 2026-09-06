// POST /api/baskets — save a basket for sharing by short link. Signed-in users
// only (the row is tied to the Privy user), 30/min per user. The payload is held
// to exactly the rules a `?basket=` link is held to (sharedBasketFrom): known
// chain, ≤12 routable holdings, weights that normalise to 100, capped name/tagline,
// a known icon. Risk is recomputed server-side, never trusted.
// → 201 { id, url: "/app?b=<id>" }
import type { NextRequest } from "next/server";
import { z } from "zod";
import { BASKET_ICONS, BASKET_MAX_ITEMS, BASKET_NAME_MAX, BASKET_TAGLINE_MAX, sharedBasketFrom } from "@/lib/baskets";
import { CHAIN_KEYS } from "@/lib/chains";
import { saveBasket } from "@/lib/server/basketsStore";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";
import { touchUser } from "@/lib/server/users";
import { appUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

const BasketBodySchema = z.object({
  chain: z.enum(CHAIN_KEYS as [string, ...string[]]),
  name: z.string().max(BASKET_NAME_MAX * 2), // sharedBasketFrom trims to the real cap after cleaning
  tagline: z.string().max(BASKET_TAGLINE_MAX * 2).optional().default(""),
  icon: z.enum(BASKET_ICONS),
  items: z
    .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.number().finite().positive().max(100) }))
    .min(1)
    .max(BASKET_MAX_ITEMS),
  source: z.object({ goal: z.string().max(200).optional() }).optional(),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = rateLimit(`baskets:${user.userId}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof BasketBodySchema>;
  try {
    body = BasketBodySchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  const res = sharedBasketFrom(body);
  if (!res.ok) return badRequest(res.reason);

  try {
    await touchUser(user.userId);
    const id = await saveBasket(res.basket, user.userId);
    return Response.json({ id, url: appUrl(`?b=${id}`) }, { status: 201 });
  } catch (err) {
    return serverError("baskets", err);
  }
}
