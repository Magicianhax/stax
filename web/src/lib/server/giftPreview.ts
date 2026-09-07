import "server-only";

// The share-link preview, as a function a SERVER COMPONENT can import directly.
// `/gift/[id]` renders on the server, so importing this beats fetching our own route
// handler: no absolute-URL guessing, no extra hop, and the page can return notFound()
// on a null instead of unpacking a 404 body.
//
// GET /api/gifts/preview?id= is the same thing over HTTP, for client-side callers.
// Both go through here, so the two can never disagree about what is safe to show.
//
// Safe to render to anyone: basket name, amount, note, unlock date, the giver's first
// name, and the basket's split so the page can draw its asset tiles. No email, no
// addresses, no token amounts, no transaction hashes. A gift nobody
// funded reads as null, exactly like an id that never existed.
import type { ChainKey } from "@/lib/chains";
import type { GiftPreview, GiftStatus } from "@/lib/gifts";
import { emailsFor, firstNameFromEmail, getGiftRow, isGiftId, parsedHoldings } from "@/lib/server/giftsStore";

/** The public preview for `id`, or null when there is nothing a stranger may see. */
export async function loadGiftPreview(id: string | null | undefined, now = Date.now()): Promise<GiftPreview | null> {
  if (!isGiftId(id)) return null;
  const row = await getGiftRow(id);
  if (!row || row.status === "pending" || row.status === "failed") return null;

  const givers = await emailsFor([row.fromUserId]);
  const status = row.status as GiftStatus;
  return {
    id: row.id as `0x${string}`,
    chain: row.chain as ChainKey,
    basketName: row.basketName,
    amountUsd: Number(row.amountUsd),
    note: row.note,
    unlockAt: row.unlockAt.toISOString(),
    fromName: firstNameFromEmail(givers.get(row.fromUserId) ?? null),
    status,
    claimable: status === "funded" && row.unlockAt.getTime() <= now,
    holdings: parsedHoldings(row),
  };
}
