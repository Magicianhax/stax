import "server-only";

// Gifts (Postgres + the TimelockGift contract). See docs/GIFTS.md.
//
// A gift is addressed to an email or to an X username. Both take the SAME two hashes over
// the same two columns — only the claim check differs — so nothing about the storage or
// the contract changes when the kind does.
//
// The recipient's address or handle never lands in a column. Two different hashes are
// taken of it, for two different jobs:
//
//   lookupHash(recipient)            deterministic, peppered with GIFT_EMAIL_PEPPER.
//                                    Stored as `recipient_email_hash` and indexed, so
//                                    "gifts addressed to me" is one indexed lookup
//                                    instead of a scan. A stolen database dump cannot
//                                    be run through a wordlist without the pepper.
//   onChainHash(salt, recipient)     per-gift salt, goes on-chain as `recipientHash`.
//                                    Two gifts to the same person share no on-chain
//                                    value, so nobody reading Base can link them.
//
// Each kind hashes in its own namespace, so an email and a handle can never collide, and
// every email gift written before X existed keeps hashing to exactly the string it did.
//
// Neither hash is ever the authority for a claim: `claim-authorisation` compares the
// signed-in user's Privy identity against the lookup hash server-side, and only then does
// the server sign. The contract trusts that signature, not the hash.
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Address } from "viem";
import type { ChainKey } from "@/lib/chains";
import { db, gifts, users, type GiftRow } from "@/lib/db";
import { serverClient } from "@/lib/server/chain";
import { getBasket } from "@/lib/server/basketsStore";
import { getChain } from "@/lib/chains";
import { curatedBasketById, isBasketInvestable, isBasketShortId, type Basket } from "@/lib/baskets";
import { fetchPrivyEmail, fetchPrivyXUsername } from "@/lib/server/privyAuth";
import {
  giftContractFor,
  normalizeEmail,
  normalizeXUsername,
  recipientLabel,
  TIMELOCK_GIFT_ABI,
  type GiftHolding,
  type GiftRecipient,
  type GiftRecipientKind,
  type GiftStatus,
  type GiftSummary,
  type GiftToken,
} from "@/lib/gifts";
import { absoluteSiteUrl } from "@/lib/urls";

/**
 * Server-side pepper for the lookup hash. Optional: without it the lookup hash is a plain
 * SHA-256 of the address, which still keeps emails out of the column but is guessable by
 * anyone holding a dump. Set it in production and never rotate it — every existing row's
 * lookup hash would stop matching.
 */
const PEPPER = process.env.GIFT_EMAIL_PEPPER ?? "";

const sha256 = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");

/**
 * The recipient reduced to the exact bytes both hashes are taken over.
 *
 * The email form is byte-for-byte what it was before X recipients existed, so every gift
 * already in the table keeps hashing to the value stored against it. X gets its own
 * ":x:" namespace rather than sharing one, so no handle can ever collide with an address.
 */
function hashSubject(recipient: GiftRecipient): string {
  return recipient.kind === "x"
    ? `x:${normalizeXUsername(recipient.username)}`
    : normalizeEmail(recipient.email);
}

/** The indexed, deterministic hash of a recipient. Hex, no 0x. */
export function lookupHash(recipient: GiftRecipient): string {
  return sha256(`stax-gift:v1:${PEPPER}:${hashSubject(recipient)}`);
}

/** The per-gift hash that goes on-chain. 0x + 32 bytes. */
export function onChainHash(salt: string, recipient: GiftRecipient): `0x${string}` {
  return `0x${sha256(`stax-gift:onchain:v1:${salt}:${hashSubject(recipient)}`)}`;
}

/** A fresh giftId: 0x + 32 random bytes. Also the database row id and the share link. */
export function newGiftId(): `0x${string}` {
  return `0x${randomBytes(32).toString("hex")}`;
}

/** A fresh per-gift salt. */
export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

/** True for a well-formed giftId. Used before every lookup so a bad link never hits the db. */
export function isGiftId(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

/**
 * "alex.chen@gmail.com" → "Alex". Best effort and deliberately narrow: only the leading
 * run of letters, only when it reads like a name. The giver is the one handing out the
 * link, so showing their first name on it is the point; anything ambiguous returns null
 * rather than leaking a fragment of an address.
 */
export function firstNameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const local = normalizeEmail(email).split("@")[0] ?? "";
  const head = /^[a-z]+/.exec(local)?.[0] ?? "";
  if (head.length < 2 || head.length > 20) return null;
  return head[0].toUpperCase() + head.slice(1);
}

// ── who a gift is for, and whether the caller is them ────────────────────────
/** A row's recipient kind, with anything unrecognised read as the original 'email'. */
export function recipientKindOf(row: Pick<GiftRow, "recipientKind">): GiftRecipientKind {
  return row.recipientKind === "x" ? "x" : "email";
}

/** The email and X handle Privy holds for a user. Either or both may be null. */
export interface PrivyIdentities {
  email: string | null;
  username: string | null;
}

/**
 * Everything Privy knows about who `userId` is, in one round trip.
 *
 * This is the whole of "who am I" for gifting, and it is read from the PRIVY USER RECORD
 * with the app's own credentials. Nothing a request carries reaches it. Callers that also
 * want to persist the identities take them from here rather than asking Privy twice.
 */
export async function privyIdentitiesFor(userId: string): Promise<PrivyIdentities> {
  const [email, username] = await Promise.all([fetchPrivyEmail(userId), fetchPrivyXUsername(userId)]);
  return { email, username };
}

/** Those identities as lookup hashes — the form "gifts addressed to me" is asked in. */
export function recipientHashesOf(identities: PrivyIdentities): string[] {
  const hashes: string[] = [];
  if (identities.email) hashes.push(lookupHash({ kind: "email", email: identities.email }));
  if (identities.username) hashes.push(lookupHash({ kind: "x", username: identities.username }));
  return hashes;
}

/** Every identity Privy holds for `userId`, as lookup hashes — their email, X handle, or both. */
export async function recipientHashesFor(userId: string): Promise<string[]> {
  return recipientHashesOf(await privyIdentitiesFor(userId));
}

/**
 * Does the signed-in caller own the identity this gift is addressed to?
 *
 * THE security gate for claiming, and the one function both claim routes go through, so
 * the email path and the X path can never drift apart. The identity is fetched from Privy
 * server-side on the line below; the request body has no field for one and is never read.
 * A gift addressed to an email is answered only by `fetchPrivyEmail`, which keeps its
 * EMAIL_TRUSTED_PROVIDERS guard exactly as it was — adding X weakens nothing.
 */
export async function callerOwnsRecipient(userId: string, row: GiftRow): Promise<boolean> {
  const kind = recipientKindOf(row);
  const identity =
    kind === "x" ? await fetchPrivyXUsername(userId) : await fetchPrivyEmail(userId);
  if (!identity) return false;
  const recipient: GiftRecipient =
    kind === "x" ? { kind: "x", username: identity } : { kind: "email", email: identity };
  return lookupHash(recipient) === row.recipientEmailHash;
}

// ── writes ───────────────────────────────────────────────────────────────────
export interface NewGiftInput {
  id: `0x${string}`;
  chain: ChainKey;
  fromUserId: string;
  fromAddress: string;
  /** Already normalised and validated by `parseGiftRecipient`. */
  recipient: GiftRecipient;
  recipientSalt: string;
  basketId: string | null;
  basketName: string;
  /** The basket's split on the day it was given — a snapshot, not a lookup. */
  holdings: GiftHolding[];
  amountUsd: number;
  note: string | null;
  unlockAt: Date;
  reclaimAfter: Date;
}

/** Reserve the gift row. `status` starts at "pending" — nothing is on-chain yet. */
export async function createGift(input: NewGiftInput): Promise<GiftRow> {
  const [row] = await db
    .insert(gifts)
    .values({
      id: input.id,
      chain: input.chain,
      fromUserId: input.fromUserId,
      fromAddress: input.fromAddress.toLowerCase(),
      recipientKind: input.recipient.kind,
      recipientEmailHash: lookupHash(input.recipient),
      recipientSalt: input.recipientSalt,
      // Masked for an email, "@handle" in the clear for X. The giver's eyes only.
      recipientEmailMasked: recipientLabel(input.recipient),
      basketId: input.basketId,
      basketName: input.basketName,
      holdings: input.holdings,
      amountUsd: String(input.amountUsd),
      note: input.note,
      unlockAt: input.unlockAt,
      reclaimAfter: input.reclaimAfter,
      status: "pending",
    })
    .returning();
  return row;
}

/**
 * Mark a gift funded once the parking transaction has been verified on-chain.
 *
 * `txHash` is nullable because a gift recovered by the self-heal below was funded without
 * anyone reporting it: the contract proves the money is parked, but the hash the client
 * would have sent died with the client, and inventing one would put a lie in the receipt.
 */
export async function markFunded(id: string, txHash: string | null, tokens: GiftToken[]): Promise<GiftRow | null> {
  const [row] = await db
    .update(gifts)
    .set({ status: "funded", createTxHash: txHash, tokens, updatedAt: new Date() })
    .where(and(eq(gifts.id, id), inArray(gifts.status, ["pending", "funded"])))
    .returning();
  return row ?? null;
}

/**
 * Give up on a reservation nothing was ever parked against, so it stops reading as
 * "Setting up" for ever. The WHERE is guarded on `pending` rather than the wider list the
 * other writers use: a gift that has since been funded must never be walked back by a
 * self-heal that read the chain a moment too early.
 */
export async function markFailed(id: string): Promise<GiftRow | null> {
  const [row] = await db
    .update(gifts)
    .set({ status: "failed", updatedAt: new Date() })
    .where(and(eq(gifts.id, id), eq(gifts.status, "pending")))
    .returning();
  return row ?? null;
}

/** Mark a gift claimed once `getGift(...).claimed` is true on-chain. */
export async function markClaimed(id: string, claimedByUserId: string, txHash: string): Promise<GiftRow | null> {
  const [row] = await db
    .update(gifts)
    .set({ status: "claimed", claimTxHash: txHash, claimedByUserId, updatedAt: new Date() })
    .where(and(eq(gifts.id, id), inArray(gifts.status, ["funded", "claimed"])))
    .returning();
  return row ?? null;
}

/** Mark a gift reclaimed by its giver. */
export async function markReclaimed(id: string, txHash: string): Promise<GiftRow | null> {
  const [row] = await db
    .update(gifts)
    .set({ status: "reclaimed", claimTxHash: txHash, updatedAt: new Date() })
    .where(and(eq(gifts.id, id), inArray(gifts.status, ["funded", "reclaimed"])))
    .returning();
  return row ?? null;
}

// ── reads ────────────────────────────────────────────────────────────────────
export async function getGiftRow(id: string): Promise<GiftRow | null> {
  const [row] = await db.select().from(gifts).where(eq(gifts.id, id)).limit(1);
  return row ?? null;
}

/**
 * Everything the caller is on either side of, newest first.
 *
 * `recipientHashes` is every identity Privy knows for them — their email, their X handle,
 * or both — each already run through `lookupHash`. Empty when Privy knows neither, and
 * then they simply have no received gifts. One indexed `in` covers both kinds, so adding
 * X costs the query nothing.
 */
export async function listGiftsFor(
  chain: ChainKey,
  userId: string,
  recipientHashes: string[],
): Promise<{ sent: GiftRow[]; received: GiftRow[] }> {
  const mine =
    recipientHashes.length > 0
      ? or(eq(gifts.fromUserId, userId), inArray(gifts.recipientEmailHash, recipientHashes))!
      : eq(gifts.fromUserId, userId);
  const rows = await db
    .select()
    .from(gifts)
    .where(and(eq(gifts.chain, chain), mine))
    .orderBy(desc(gifts.createdAt))
    .limit(200);

  const addressedToMe = new Set(recipientHashes);
  const sent: GiftRow[] = [];
  const received: GiftRow[] = [];
  for (const row of rows) {
    // A gift you sent to your own address shows up on both sides, which is honest.
    if (row.fromUserId === userId) sent.push(row);
    // A `pending` row is a reservation and nothing more: no money is parked and the
    // contract has never heard of it, so there is nothing addressed to the recipient yet.
    // Showing it would announce a gift that may never exist. The giver keeps seeing their
    // own pending rows — that side of it is real work they started.
    if (addressedToMe.has(row.recipientEmailHash) && row.status !== "pending") received.push(row);
  }
  return { sent, received };
}

/**
 * How each of `userIds` is named as a giver: the first name from their email, else their
 * X handle as "@name". Null when we know neither, and then the gift simply reads without
 * a name rather than showing a stranger a fragment of an address.
 */
export async function giverLabelsFor(userIds: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, email: users.email, xUsername: users.xUsername })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, giverLabel(r.email, r.xUsername)]));
}

/** The one place a giver's display name is decided, so every screen agrees on it. */
export function giverLabel(email: string | null, xUsername: string | null): string | null {
  return firstNameFromEmail(email) ?? (xUsername ? `@${xUsername}` : null);
}

// ── on-chain truth ───────────────────────────────────────────────────────────
export interface OnChainGift {
  from: Address;
  recipientHash: `0x${string}`;
  unlockAt: bigint;
  reclaimAfter: bigint;
  claimed: boolean;
  tokens: readonly Address[];
  amounts: readonly bigint[];
  note: string;
}

/**
 * Read the gift straight from TimelockGift on `chain`. Returns null when the contract
 * has never heard of the id (`from` is the zero address). The routes call this before
 * believing any client-supplied "it's funded" / "it's claimed" claim.
 */
export async function readOnChainGift(chain: ChainKey, giftContract: Address, id: `0x${string}`): Promise<OnChainGift | null> {
  const client = serverClient(getChain(chain));
  const gift = (await client.readContract({
    address: giftContract,
    abi: TIMELOCK_GIFT_ABI,
    functionName: "getGift",
    args: [id],
  })) as OnChainGift;
  if (!gift || gift.from === "0x0000000000000000000000000000000000000000") return null;
  return gift;
}

// ── the stale-pending self-heal ──────────────────────────────────────────────
/**
 * How long a row may sit `pending` before we stop believing the client is still working.
 * Reserving, investing and parking is a matter of seconds; ten minutes means the tab was
 * closed, the network died, or the funded callback never landed.
 */
const STALE_PENDING_MS = 10 * 60_000;

/** The list endpoint is on the critical path of the gifts screen, so cap the RPC work. */
const STALE_PENDING_MAX = 5;

/**
 * What the contract says is parked, as the row records it. Only reached when the funded
 * callback was lost, so the chain is the only place these amounts still exist. A token
 * outside the chain's asset list keeps its address as the symbol rather than being
 * dropped — an odd-looking line is recoverable, a missing holding is not.
 */
function tokensFromOnChain(chain: ChainKey, onChain: OnChainGift): GiftToken[] {
  const staxChain = getChain(chain);
  return onChain.tokens.map((address, i) => {
    const lower = address.toLowerCase();
    const symbol =
      lower === staxChain.usdc.address.toLowerCase()
        ? staxChain.usdc.symbol
        : (staxChain.assets.all.find((a) => a.address?.toLowerCase() === lower)?.symbol ?? lower);
    return { symbol, address: lower as `0x${string}`, amount: String(onChain.amounts[i] ?? BigInt(0)) };
  });
}

/** The chain's verdict on one stale row, or null when it says nothing we can act on. */
async function settleStalePending(
  chain: ChainKey,
  giftContract: Address,
  row: GiftRow,
): Promise<GiftRow | null> {
  const onChain = await readOnChainGift(chain, giftContract, row.id as `0x${string}`);
  // Nothing on-chain means the money was never parked, so nothing was taken from anyone.
  if (!onChain) return markFailed(row.id);
  // The same identity checks the funded route runs, because this writes the same row.
  if (onChain.from.toLowerCase() !== row.fromAddress.toLowerCase()) return null;
  if (Number(onChain.unlockAt) !== Math.floor(row.unlockAt.getTime() / 1000)) return null;
  return markFunded(row.id, row.createTxHash, tokensFromOnChain(chain, onChain));
}

/**
 * Resolve the caller's own gifts that have been stuck `pending` too long, by asking the
 * contract what really happened: funded if the money is parked, failed if it never was.
 * Without this a client that dies between reserving and reporting leaves a row reading
 * "Setting up" for ever, with no path out of it.
 *
 * `rows` arrives newest first, so the cap takes the most recent stale rows. Everything is
 * wrapped: a flaky RPC must degrade to leaving the row pending, never to failing the list.
 */
export async function healStalePendingGifts(
  chain: ChainKey,
  rows: GiftRow[],
  now = Date.now(),
): Promise<GiftRow[]> {
  const giftContract = giftContractFor(chain);
  if (!giftContract) return rows;
  const stale = rows
    .filter((r) => r.status === "pending" && now - r.createdAt.getTime() > STALE_PENDING_MS)
    .slice(0, STALE_PENDING_MAX);
  if (stale.length === 0) return rows;
  try {
    const settled = await Promise.all(stale.map((row) => settleStalePending(chain, giftContract, row)));
    const healed = new Map(settled.filter((r): r is GiftRow => r !== null).map((r) => [r.id, r]));
    return healed.size === 0 ? rows : rows.map((r) => healed.get(r.id) ?? r);
  } catch (e) {
    console.warn("[gifts] stale-pending self-heal failed:", e instanceof Error ? e.message : e);
    return rows;
  }
}

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** The caller's spendable USDC on `chain`, in dollars. A gift can never exceed it. */
export async function usdcBalanceUsd(chain: ChainKey, address: Address): Promise<number> {
  const staxChain = getChain(chain);
  const client = serverClient(staxChain);
  const raw = await client.readContract({
    address: staxChain.usdc.address,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return Number(raw) / 10 ** staxChain.usdc.decimals;
}

// ── baskets ──────────────────────────────────────────────────────────────────
export type GiftBasketLookup =
  | { ok: true; basket: Basket }
  | { ok: false; reason: string };

/**
 * The basket a gift is built from: a curated id ("base:big-tech") first, then a shared
 * basket by short id. Unlike an autopilot target this does NOT require ownership — the
 * whole point of a shared basket link is that someone else can buy it, and here they
 * are buying it for a third person.
 */
export async function resolveGiftBasket(chain: ChainKey, basketId: string): Promise<GiftBasketLookup> {
  const staxChain = getChain(chain);
  const curated = curatedBasketById(chain, basketId);
  if (curated) {
    return isBasketInvestable(staxChain, curated)
      ? { ok: true, basket: curated }
      : { ok: false, reason: `This basket holds something you can't buy on ${staxChain.name} right now.` };
  }
  if (!isBasketShortId(basketId)) return { ok: false, reason: "That basket isn't here. It may have been removed." };
  const stored = await getBasket(basketId);
  if (!stored) return { ok: false, reason: "That basket isn't here. It may have been removed." };
  if (!stored.ok) return { ok: false, reason: stored.reason };
  if (stored.basket.chain !== chain) return { ok: false, reason: "That basket belongs to a different network." };
  return { ok: true, basket: stored.basket };
}

// ── presentation ─────────────────────────────────────────────────────────────
/**
 * The link a giver hands to their recipient. It points at the PUBLIC share page, not
 * into the app: someone who has never heard of Stax should land on the note, the amount
 * and the unlock date, and choose to open the app from there.
 */
export function giftShareUrl(id: string): string {
  return absoluteSiteUrl(`/gift/${id}`);
}
function parsedTokens(row: GiftRow): GiftToken[] {
  return Array.isArray(row.tokens) ? (row.tokens as GiftToken[]) : [];
}

/** The snapshotted split. Empty for a row written before the column existed. */
export function parsedHoldings(row: GiftRow): GiftHolding[] {
  return Array.isArray(row.holdings) ? (row.holdings as GiftHolding[]) : [];
}

/** The row as the app shows it, from the caller's side of the gift. */
export function toSummary(
  row: GiftRow,
  direction: "sent" | "received",
  fromLabel: string | null,
  now = Date.now(),
): GiftSummary {
  const status = row.status as GiftStatus;
  const unlocked = row.unlockAt.getTime() <= now;
  const past = row.reclaimAfter.getTime() <= now;
  return {
    id: row.id as `0x${string}`,
    chain: row.chain as ChainKey,
    direction,
    status,
    basketId: row.basketId,
    basketName: row.basketName,
    amountUsd: Number(row.amountUsd),
    note: row.note,
    unlockAt: row.unlockAt.toISOString(),
    reclaimAfter: row.reclaimAfter.toISOString(),
    createdAt: row.createdAt.toISOString(),
    tokens: parsedTokens(row),
    holdings: parsedHoldings(row),
    createTxHash: row.createTxHash,
    claimTxHash: row.claimTxHash,
    recipientKind: recipientKindOf(row),
    // The giver's eyes only. A received gift already knows who it is for, and showing it
    // there would put a stranger's address or handle on someone else's screen.
    recipientLabel: direction === "sent" ? row.recipientEmailMasked : null,
    fromName: direction === "received" ? fromLabel : null,
    claimable: direction === "received" && status === "funded" && unlocked,
    reclaimable: direction === "sent" && status === "funded" && past,
    shareUrl: direction === "sent" ? giftShareUrl(row.id) : null,
  };
}
