// POST /api/gifts/[id]/claim-authorisation — the security-critical route.
//
// TimelockGift cannot know who owns an email address or an X handle, so it delegates that
// one question here: an EIP-712 signature over (giftId, to, deadline) by
// GIFT_SIGNER_PRIVATE_KEY is the contract's only authority for releasing a gift.
// Everything this route checks is therefore load-bearing:
//
//   • the caller has a live Privy session (verifyRequest)
//   • the identity this gift is addressed to — the email or the X username on their
//     PRIVY USER RECORD, fetched server-side, never read from the request body — hashes
//     to this gift's `recipient_email_hash` (callerOwnsRecipient)
//   • `to` is THEIR OWN smart account, derived from Privy by ownedAddresses, not supplied
//   • the contract agrees the gift exists, is unclaimed, and has passed its unlock date
//
// The attestation lives 10 minutes, so a leaked one is worthless by the time it travels.
// → { giftContract, giftId, to, deadline, signature, gift }
import type { NextRequest } from "next/server";
import { giftContractFor } from "@/lib/gifts";
import { getChain } from "@/lib/chains";
import { CLAIM_DEADLINE_SECONDS, GIFT_SIGNER_CONFIGURED, signClaim } from "@/lib/server/giftSigner";
import {
  callerOwnsRecipient,
  getGiftRow,
  giverLabelsFor,
  isGiftId,
  readOnChainGift,
  recipientKindOf,
  toSummary,
} from "@/lib/server/giftsStore";
import { ownedAddresses } from "@/lib/server/ownedAddresses";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // Tighter than the rest: this is the endpoint an attacker would grind against.
  const limit = await rateLimit(`gifts-claim-auth:${user.userId}`, 10, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const { id } = await params;
  if (!isGiftId(id)) return badRequest("That doesn't look like a Stax gift.");
  if (!GIFT_SIGNER_CONFIGURED) return jsonError(503, "Gift claiming isn't switched on yet.");

  try {
    const row = await getGiftRow(id);
    if (!row) return jsonError(404, "That gift isn't here.");

    const chain = row.chain as "base" | "mantle";
    const giftContract = giftContractFor(chain);
    if (!giftContract) return jsonError(503, "Gifting isn't switched on for this network yet.");

    // Ownership of the identity is the whole gate. `callerOwnsRecipient` reads the email
    // or the X username off the caller's PRIVY USER RECORD with the app credentials and
    // hashes that. The request body is never consulted and has no field for either.
    const isX = recipientKindOf(row) === "x";
    if (!(await callerOwnsRecipient(user.userId, row))) {
      return jsonError(
        403,
        isX
          ? "This gift is addressed to a different X account. Sign in with that account to open it."
          : "This gift is addressed to a different email.",
      );
    }

    if (row.status === "claimed") return jsonError(409, "This gift has already been claimed.");
    if (row.status === "reclaimed") return jsonError(409, "The sender took this gift back.");
    if (row.status !== "funded") return jsonError(409, "This gift isn't ready yet.");
    if (row.unlockAt.getTime() > Date.now()) return jsonError(409, "This gift hasn't opened yet.");

    // The recipient's own account, derived from Privy. Never a body-supplied address.
    const owned = await ownedAddresses(user.userId);
    if (!owned.primary) return jsonError(409, "We couldn't find your Stax account. Please sign in again.");
    const to = owned.primary as `0x${string}`;

    // The contract is the last word on whether there is anything left to release.
    const onChain = await readOnChainGift(chain, giftContract, id);
    if (!onChain) return jsonError(409, "We can't see that gift on-chain.");
    if (onChain.claimed) return jsonError(409, "This gift has already been claimed.");
    if (Number(onChain.unlockAt) * 1000 > Date.now()) return jsonError(409, "This gift hasn't opened yet.");

    const deadline = BigInt(Math.floor(Date.now() / 1000) + CLAIM_DEADLINE_SECONDS);
    const signature = await signClaim(getChain(chain), giftContract, { giftId: id, to, deadline });

    const givers = await giverLabelsFor([row.fromUserId]);
    return Response.json({
      giftContract,
      giftId: id,
      to,
      deadline: Number(deadline),
      signature,
      gift: toSummary(row, "received", givers.get(row.fromUserId) ?? null),
    });
  } catch (err) {
    return serverError("gifts-claim-auth", err);
  }
}
