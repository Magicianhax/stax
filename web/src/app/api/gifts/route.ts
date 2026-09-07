// /api/gifts — the giver's half of "gift a basket" (docs/GIFTS.md).
//
//   POST  reserve a gift: validate, mint the giftId + salt + email hash, write the
//         `pending` row, and hand the client back everything it needs to execute.
//         NOTHING is on-chain yet — the client invests through the normal executor
//         path (the bought tokens land in the giver's own account) and then parks
//         them with TimelockGift.create in a second sponsored user op.
//   GET   every gift the caller is on either side of: what they sent, and what is
//         addressed to the email Privy has on file for them.
//
// The recipient's email is hashed on the way in and never stored. See
// lib/server/giftsStore.ts for why there are two different hashes.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { basketToAllocation, riskScoreFor } from "@/lib/baskets";
import { getChain } from "@/lib/chains";
import {
  GIFT_MAX_USD,
  GIFT_MAX_UNLOCK_YEARS,
  GIFT_MIN_UNLOCK_MINUTES,
  GIFT_MIN_USD,
  GIFT_NOTE_MAX,
  GIFT_RECLAIM_GRACE_DAYS,
  giftContractFor,
  parseGiftRecipient,
  recipientLabel,
  splitGiftBasket,
  type GiftRecipient,
  type GiftSummary,
} from "@/lib/gifts";
import { chainKeyFromRequest } from "@/lib/server/chain";
import { assertSignerMatchesContract, GIFT_SIGNER_CONFIGURED } from "@/lib/server/giftSigner";
import {
  createGift,
  giftShareUrl,
  giverLabelsFor,
  healStalePendingGifts,
  listGiftsFor,
  newGiftId,
  newSalt,
  onChainHash,
  privyIdentitiesFor,
  recipientHashesOf,
  resolveGiftBasket,
  toSummary,
  usdcBalanceUsd,
} from "@/lib/server/giftsStore";
import { ownedAddresses } from "@/lib/server/ownedAddresses";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";
import { touchUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_MS = 86_400_000;

/**
 * Who the gift is for. A discriminated union rather than two optional fields, so a body
 * can never arrive carrying both an email and a handle with no rule for which wins.
 *
 * The lengths here are only a sanity cap on what is worth parsing — `parseGiftRecipient`
 * is what actually normalises and validates, and it is the same function the give flow
 * runs, so the screen and the server agree on what a valid recipient is.
 */
const Recipient = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), email: z.string().min(6).max(254) }),
  // 20, not 15: the cap is on the raw string, which may still carry "@" and whitespace.
  z.object({ kind: z.literal("x"), username: z.string().min(1).max(20) }),
]);

const Body = z
  .object({
    basketId: z.string().min(1).max(64),
    amountUsd: z.number().finite().min(GIFT_MIN_USD).max(GIFT_MAX_USD),
    recipient: Recipient.optional(),
    /** The pre-X body shape. Still accepted, read as the email kind. */
    recipientEmail: z.string().min(6).max(254).optional(),
    unlockAt: z.string().min(4).max(40),
    note: z.string().max(GIFT_NOTE_MAX * 2).optional(),
  })
  .refine((b) => b.recipient !== undefined || b.recipientEmail !== undefined, {
    message: "A gift needs someone to be for.",
    path: ["recipient"],
  });

/**
 * Trim and cap the note to GIFT_NOTE_MAX BYTES, which is what the contract counts.
 * Cutting on a code-point boundary keeps an emoji or an accent from being split in half.
 */
function capNote(note: string | undefined): string {
  const trimmed = (note ?? "").trim().replace(/\s+/g, " ");
  if (Buffer.byteLength(trimmed, "utf8") <= GIFT_NOTE_MAX) return trimmed;
  let out = "";
  for (const ch of trimmed) {
    if (Buffer.byteLength(out + ch, "utf8") > GIFT_NOTE_MAX) break;
    out += ch;
  }
  return out;
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = await rateLimit(`gifts-create:${user.userId}`, 10, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainKeyFromRequest(req);
  const giftContract = giftContractFor(chain);
  if (!giftContract) return jsonError(503, "Gifting isn't switched on for this network yet.");

  // A signer mismatch would fund the gift and then make it unclaimable forever, so it
  // has to fail here, before any money moves, not at claim time years later.
  if (!GIFT_SIGNER_CONFIGURED) return jsonError(503, "Gifting isn't switched on yet.");
  const signerOk = await assertSignerMatchesContract(getChain(chain), giftContract);
  if (!signerOk.ok) {
    console.error(
      `[gifts] signer mismatch on ${chain}: contract expects ${signerOk.expected}, server signs with ${signerOk.configured}`,
    );
    return jsonError(503, "Gifting is misconfigured right now. Nothing was charged.");
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Check the amount, who it's for and the date, then try again.");
  }

  // One canonical recipient, whichever shape the body used. A bare `recipientEmail` is
  // the email kind; everything downstream sees the same normalised value either way.
  const asked: GiftRecipient = body.recipient ?? { kind: "email", email: body.recipientEmail! };
  const recipient = parseGiftRecipient(asked);
  if (!recipient) {
    return badRequest(
      asked.kind === "x"
        ? "That X username doesn't look right. Up to 15 letters, numbers or underscores."
        : "That email address doesn't look right.",
    );
  }

  const now = Date.now();
  const unlockAt = new Date(body.unlockAt);
  if (Number.isNaN(unlockAt.getTime())) return badRequest("That unlock date isn't a date.");
  if (unlockAt.getTime() < now + GIFT_MIN_UNLOCK_MINUTES * 60_000) {
    return badRequest(`Pick a time at least ${GIFT_MIN_UNLOCK_MINUTES} minutes from now.`);
  }
  if (unlockAt.getTime() > now + GIFT_MAX_UNLOCK_YEARS * 365 * DAY_MS) {
    return badRequest(`Pick an unlock date within ${GIFT_MAX_UNLOCK_YEARS} years.`);
  }
  const reclaimAfter = new Date(unlockAt.getTime() + GIFT_RECLAIM_GRACE_DAYS * DAY_MS);

  try {
    const found = await resolveGiftBasket(chain, body.basketId);
    if (!found.ok) return jsonError(404, found.reason);
    const { basket } = found;

    // The account the gift is bought and parked from. Derived server-side from Privy —
    // a client-supplied address is never trusted here.
    const owned = await ownedAddresses(user.userId);
    if (!owned.primary) return jsonError(409, "We couldn't find your Stax account. Please sign in again.");
    const from = owned.primary as `0x${string}`;

    const cash = await usdcBalanceUsd(chain, from);
    if (body.amountUsd > cash + 0.01) {
      return badRequest("That's more than your available cash. Add money or lower the amount.");
    }

    // Aave "Safe Dollars" rebases and TimelockGift pays back the amount it recorded, so
    // that slice is parked as plain USDC instead of the aToken. See splitGiftBasket.
    const split = splitGiftBasket(chain, basket.items, body.amountUsd);

    const id = newGiftId();
    const salt = newSalt();
    const note = capNote(body.note);

    await touchUser(user.userId);
    await createGift({
      id,
      chain,
      fromUserId: user.userId,
      fromAddress: from,
      recipient,
      recipientSalt: salt,
      basketId: basket.id,
      basketName: basket.name,
      holdings: split.holdings,
      amountUsd: body.amountUsd,
      note: note || null,
      unlockAt,
      reclaimAfter,
    });

    return Response.json(
      {
        giftId: id,
        chain,
        giftContract,
        recipientHash: onChainHash(salt, recipient),
        unlockAt: Math.floor(unlockAt.getTime() / 1000),
        reclaimAfter: Math.floor(reclaimAfter.getTime() / 1000),
        unlockAtIso: unlockAt.toISOString(),
        reclaimAfterIso: reclaimAfter.toISOString(),
        note,
        allocation:
          split.invested.length > 0
            ? basketToAllocation(
                { ...basket, items: split.invested, riskScore: riskScoreFor(getChain(chain), split.invested) },
                split.investUsd,
              )
            : null,
        investUsd: split.investUsd,
        cashUsd: split.cashUsd,
        cashToken: split.cashToken,
        holdings: split.holdings,
        basketName: basket.name,
        recipientKind: recipient.kind,
        recipientLabel: recipientLabel(recipient),
        shareUrl: giftShareUrl(id),
      },
      { status: 201 },
    );
  } catch (err) {
    return serverError("gifts-create", err);
  }
}

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = await rateLimit(`gifts-list:${user.userId}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainKeyFromRequest(req);

  try {
    // "Addressed to me" is decided by the identities on the Privy user record — their
    // email and their X handle — never by anything the request carries.
    const identities = await privyIdentitiesFor(user.userId);
    // Write them down while we have them. A giver who signed in with X has no email at
    // all, and their recipient can only be shown a name if the handle is on file — so
    // opening your own gifts screen once is enough for every gift you send after it.
    await touchUser(user.userId, identities.email, identities.username);
    const { sent, received } = await listGiftsFor(chain, user.userId, recipientHashesOf(identities));

    // Ask the chain about the caller's own rows that have been "Setting up" too long,
    // before deciding what to show — otherwise a lost callback strands one for ever.
    const settledSent = await healStalePendingGifts(chain, sent);

    const givers = await giverLabelsFor(received.map((r) => r.fromUserId));
    const now = Date.now();
    const body: { sent: GiftSummary[]; received: GiftSummary[] } = {
      sent: settledSent.map((row) => toSummary(row, "sent", null, now)),
      received: received.map((row) => toSummary(row, "received", givers.get(row.fromUserId) ?? null, now)),
    };
    return Response.json(body);
  } catch (err) {
    return serverError("gifts-list", err);
  }
}
