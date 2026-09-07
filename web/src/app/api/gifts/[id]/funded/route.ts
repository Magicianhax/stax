// POST /api/gifts/[id]/funded — the parking transaction landed; flip the row to `funded`.
//
// The body is a hint, never the truth. Before believing anything the server reads
// TimelockGift.getGift(id) on chain and checks that the gift is really there, was created
// by this caller's account, unlocks on the date we recorded, and holds exactly the tokens
// and amounts the body claims. A client that lies gets a 409 and the row stays `pending`.
// → { gift }
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { giftContractFor } from "@/lib/gifts";
import { getGiftRow, isGiftId, markFunded, readOnChainGift, toSummary } from "@/lib/server/giftsStore";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash."),
  tokens: z
    .array(
      z.object({
        symbol: z.string().min(1).max(12),
        address: z.string().refine((a) => isAddress(a), "Invalid token address."),
        amount: z.string().regex(/^\d{1,78}$/, "Invalid amount."),
      }),
    )
    .min(1)
    .max(12),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = await rateLimit(`gifts-funded:${user.userId}`, 30, 60_000);
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
    if (row.fromUserId !== user.userId) return jsonError(403, "That isn't your gift.");

    const chain = row.chain as "base" | "mantle";
    const giftContract = giftContractFor(chain);
    if (!giftContract) return jsonError(503, "Gifting isn't switched on for this network yet.");

    const onChain = await readOnChainGift(chain, giftContract, id);
    if (!onChain) return jsonError(409, "We can't see that gift on-chain yet. Give it a moment and try again.");
    if (onChain.from.toLowerCase() !== row.fromAddress.toLowerCase()) {
      return jsonError(409, "That gift was created by a different account.");
    }
    if (Number(onChain.unlockAt) !== Math.floor(row.unlockAt.getTime() / 1000)) {
      return jsonError(409, "That gift was created with a different unlock date.");
    }
    if (Number(onChain.reclaimAfter) !== Math.floor(row.reclaimAfter.getTime() / 1000)) {
      return jsonError(409, "That gift was created with a different reclaim date.");
    }

    // Match the body against the contract by address, order-independent, exact amounts.
    const parked = new Map<string, bigint>();
    onChain.tokens.forEach((token, i) => {
      const key = token.toLowerCase();
      parked.set(key, (parked.get(key) ?? BigInt(0)) + onChain.amounts[i]);
    });
    const claimed = new Map<string, bigint>();
    for (const t of body.tokens) {
      const key = t.address.toLowerCase();
      claimed.set(key, (claimed.get(key) ?? BigInt(0)) + BigInt(t.amount));
    }
    const mismatch =
      parked.size !== claimed.size || [...parked].some(([addr, amount]) => claimed.get(addr) !== amount);
    if (mismatch) return jsonError(409, "That doesn't match what's parked on-chain.");

    const updated = await markFunded(id, body.txHash, body.tokens.map((t) => ({ ...t, address: t.address as `0x${string}` })));
    if (!updated) return jsonError(409, "That gift has already moved on.");
    return Response.json({ gift: toSummary(updated, "sent", null) });
  } catch (err) {
    return serverError("gifts-funded", err);
  }
}
