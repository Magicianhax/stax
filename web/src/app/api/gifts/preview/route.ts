// GET /api/gifts/preview?id=0x… — the share-link landing page, for someone who may not
// have a Stax account yet. PUBLIC, so it says as little as it possibly can: the basket
// name, the amount, the note, the unlock date, and the giver's first name when we can
// tell one. No email, no addresses, no token amounts, no transaction hashes. Knowing a
// giftId does not let you claim anything — only the signed attestation does.
// 30/min per IP.
// → GiftPreview
import type { NextRequest } from "next/server";
import type { ChainKey } from "@/lib/chains";
import type { GiftPreview, GiftStatus } from "@/lib/gifts";
import { emailsFor, firstNameFromEmail, getGiftRow, isGiftId } from "@/lib/server/giftsStore";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`gifts-preview:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const id = new URL(req.url).searchParams.get("id");
  if (!isGiftId(id)) return badRequest("That doesn't look like a Stax gift link.");

  try {
    const row = await getGiftRow(id);
    // A gift nobody ever funded is indistinguishable from one that never existed, on purpose.
    if (!row || row.status === "pending" || row.status === "failed") {
      return jsonError(404, "That gift isn't here. The link may have expired.");
    }

    const givers = await emailsFor([row.fromUserId]);
    const status = row.status as GiftStatus;
    const preview: GiftPreview = {
      id: row.id as `0x${string}`,
      chain: row.chain as ChainKey,
      basketName: row.basketName,
      amountUsd: Number(row.amountUsd),
      note: row.note,
      unlockAt: row.unlockAt.toISOString(),
      fromName: firstNameFromEmail(givers.get(row.fromUserId) ?? null),
      status,
      claimable: status === "funded" && row.unlockAt.getTime() <= Date.now(),
    };
    return Response.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("gifts-preview", err);
  }
}
