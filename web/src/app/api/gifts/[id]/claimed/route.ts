// POST /api/gifts/[id]/claimed — record the transaction that emptied a gift.
//
// Both ways out land here, because on-chain they look the same (`claimed` is set by
// `claim` and by `reclaim` alike). Which one it was is decided by who is asking:
//   • the recipient (their Privy email or X handle hashes to the gift's) → `claimed`
//   • the giver, past the grace period                                   → `reclaimed`
// The contract is checked first either way, so a client cannot mark a gift settled
// that is still sitting there.
// → { gift }
import type { NextRequest } from "next/server";
import { z } from "zod";
import { giftContractFor } from "@/lib/gifts";
import {
  callerOwnsRecipient,
  getGiftRow,
  giverLabelsFor,
  isGiftId,
  markClaimed,
  markReclaimed,
  readOnChainGift,
  toSummary,
} from "@/lib/server/giftsStore";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash.") });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = await rateLimit(`gifts-claimed:${user.userId}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const { id } = await params;
  if (!isGiftId(id)) return badRequest("That doesn't look like a Stax gift.");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const row = await getGiftRow(id);
    if (!row) return jsonError(404, "That gift isn't here.");

    const chain = row.chain as "base" | "mantle";
    const giftContract = giftContractFor(chain);
    if (!giftContract) return jsonError(503, "Gifting isn't switched on for this network yet.");

    const onChain = await readOnChainGift(chain, giftContract, id);
    if (!onChain) return jsonError(409, "We can't see that gift on-chain.");
    if (!onChain.claimed) return jsonError(409, "That gift is still parked. Nothing to record yet.");

    // Same server-side identity check the claim attestation used — one function, so the
    // email path and the X path cannot record a settlement they could not have authorised.
    const isRecipient = await callerOwnsRecipient(user.userId, row);
    const isGiver = row.fromUserId === user.userId;
    if (!isRecipient && !isGiver) return jsonError(403, "That isn't your gift.");

    const updated = isRecipient
      ? await markClaimed(id, user.userId, body.txHash)
      : await markReclaimed(id, body.txHash);
    if (!updated) return jsonError(409, "That gift has already moved on.");

    const direction = isRecipient ? "received" : "sent";
    const givers = isRecipient ? await giverLabelsFor([row.fromUserId]) : new Map<string, string | null>();
    return Response.json({ gift: toSummary(updated, direction, givers.get(row.fromUserId) ?? null) });
  } catch (err) {
    return serverError("gifts-claimed", err);
  }
}
