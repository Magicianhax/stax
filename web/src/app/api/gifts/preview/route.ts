// GET /api/gifts/preview?id=0x… — the share-link landing payload, for someone who may not
// have a Stax account yet. PUBLIC, so it says as little as it possibly can: the basket
// name, the amount, the note, the unlock date, and the giver's first name when we can tell
// one. No email, no addresses, no token amounts, no transaction hashes. Knowing a giftId
// does not let you claim anything — only the signed attestation does.
//
// A server component should import `loadGiftPreview` instead of fetching this. Both go
// through the same reader, so they can never disagree about what is safe to show.
// 30/min per IP.
// → GiftPreview
import type { NextRequest } from "next/server";
import { loadGiftPreview } from "@/lib/server/giftPreview";
import { isGiftId } from "@/lib/server/giftsStore";
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
    const preview = await loadGiftPreview(id);
    // A gift nobody ever funded is indistinguishable from one that never existed, on purpose.
    if (!preview) return jsonError(404, "That gift isn't here. The link may have expired.");
    return Response.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("gifts-preview", err);
  }
}
