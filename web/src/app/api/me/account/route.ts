// POST /api/me/account — record the smart account the signed-in user trades from.
//   body { chain: "base" | "mantle", owner: 0x…, address: 0x… }  →  { ok: true }
// Called once per session by useSmartAccount() (fire-and-forget). The stored row
// lets /api/swap-quote verify that quotes are built for the caller's own account.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import { touchUser, upsertSmartAccount } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const addr = z.string().refine((a) => isAddress(a), "Invalid address.");
const Body = z.object({
  chain: z.enum(["base", "mantle"]),
  owner: addr,
  address: addr,
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = rateLimit(`me-account:${user.userId}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Invalid account.");
  }

  try {
    await touchUser(user.userId);
    await upsertSmartAccount({
      userId: user.userId,
      chain: body.chain,
      owner: body.owner as `0x${string}`,
      address: body.address as `0x${string}`,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("me-account", err);
  }
}
