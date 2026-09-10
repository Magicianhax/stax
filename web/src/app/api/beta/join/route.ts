// POST /api/beta/join — put the signed-in user on the private-beta list (docs/BETA.md).
//   body { address?: 0x…, ref?: string }  →  Access
// Idempotent per user. `address` = the wallet the beta page saw first (embedded or
// external); `ref` = the referral code from ?ref= (ignored unless it names a live row).
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";
import { admitGiftRecipient, getAccess, joinWaitlist } from "@/lib/server/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  address: z
    .string()
    .trim()
    .refine((a) => isAddress(a), "Invalid address.")
    .optional(),
  ref: z.string().trim().max(32).optional(),
  // Honeypot: a hidden "website" field on the beta page that people never see.
  // Anything in it means a bot filled the form.
  website: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = await rateLimit(`beta-join:${user.userId}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof Body>;
  try {
    const raw = await req.text();
    body = Body.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return badRequest("Invalid request body.");
  }
  if (body.website) return badRequest();

  try {
    let access = await joinWaitlist({ userId: user.userId, address: body.address, ref: body.ref });
    // A recipient signing in to collect a gift should never see a queue position, not
    // even for the minute until the next access poll. Best-effort: joining still stands
    // if this fails.
    if (access.status === "waiting") {
      try {
        if (await admitGiftRecipient(user.userId)) access = await getAccess(user.userId);
      } catch (e) {
        console.warn("[beta-join] gift admission check failed:", e instanceof Error ? e.message : e);
      }
    }
    return Response.json(access, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("beta-join", err);
  }
}
