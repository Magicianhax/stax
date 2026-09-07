import "server-only";

// Gifts (Postgres + the TimelockGift contract). See docs/GIFTS.md.
//
// The recipient's email never lands in a column. Two different hashes are taken of it,
// for two different jobs:
//
//   lookupHash(email)                deterministic, peppered with GIFT_EMAIL_PEPPER.
//                                    Stored as `recipient_email_hash` and indexed, so
//                                    "gifts addressed to me" is one indexed lookup
//                                    instead of a scan. A stolen database dump cannot
//                                    be run through a wordlist without the pepper.
//   onChainHash(salt, email)         per-gift salt, goes on-chain as `recipientHash`.
//                                    Two gifts to the same person share no on-chain
//                                    value, so nobody reading Base can link them.
//
// Neither hash is ever the authority for a claim: `claim-authorisation` compares the
// signed-in user's Privy email against the lookup hash server-side, and only then does
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
import { maskEmail, normalizeEmail, TIMELOCK_GIFT_ABI, type GiftHolding, type GiftStatus, type GiftSummary, type GiftToken } from "@/lib/gifts";
import { absoluteSiteUrl } from "@/lib/urls";

/**
 * Server-side pepper for the lookup hash. Optional: without it the lookup hash is a plain
 * SHA-256 of the address, which still keeps emails out of the column but is guessable by
 * anyone holding a dump. Set it in production and never rotate it — every existing row's
 * lookup hash would stop matching.
 */
const PEPPER = process.env.GIFT_EMAIL_PEPPER ?? "";

const sha256 = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");

/** The indexed, deterministic hash of a recipient address. Hex, no 0x. */
export function lookupHash(email: string): string {
  return sha256(`stax-gift:v1:${PEPPER}:${normalizeEmail(email)}`);
}

/** The per-gift hash that goes on-chain. 0x + 32 bytes. */
export function onChainHash(salt: string, email: string): `0x${string}` {
  return `0x${sha256(`stax-gift:onchain:v1:${salt}:${normalizeEmail(email)}`)}`;
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

// ── writes ───────────────────────────────────────────────────────────────────
export interface NewGiftInput {
  id: `0x${string}`;
  chain: ChainKey;
  fromUserId: string;
  fromAddress: string;
  recipientEmail: string;
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
      recipientEmailHash: lookupHash(input.recipientEmail),
      recipientSalt: input.recipientSalt,
      recipientEmailMasked: maskEmail(input.recipientEmail),
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

/** Mark a gift funded once the parking transaction has been verified on-chain. */
export async function markFunded(id: string, txHash: string, tokens: GiftToken[]): Promise<GiftRow | null> {
  const [row] = await db
    .update(gifts)
    .set({ status: "funded", createTxHash: txHash, tokens, updatedAt: new Date() })
    .where(and(eq(gifts.id, id), inArray(gifts.status, ["pending", "funded"])))
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
 * Everything the caller is on either side of, newest first. `emailHash` is null when
 * Privy knows no email for them — then they simply have no received gifts.
 */
export async function listGiftsFor(
  chain: ChainKey,
  userId: string,
  emailHash: string | null,
): Promise<{ sent: GiftRow[]; received: GiftRow[] }> {
  const mine = emailHash
    ? or(eq(gifts.fromUserId, userId), eq(gifts.recipientEmailHash, emailHash))!
    : eq(gifts.fromUserId, userId);
  const rows = await db
    .select()
    .from(gifts)
    .where(and(eq(gifts.chain, chain), mine))
    .orderBy(desc(gifts.createdAt))
    .limit(200);

  const sent: GiftRow[] = [];
  const received: GiftRow[] = [];
  for (const row of rows) {
    // A gift you sent to your own address shows up on both sides, which is honest.
    if (row.fromUserId === userId) sent.push(row);
    if (emailHash && row.recipientEmailHash === emailHash) received.push(row);
  }
  return { sent, received };
}

/** The Privy email we have on file for each of `userIds`, for the giver's first name. */
export async function emailsFor(userIds: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.email]));
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
  fromEmail: string | null,
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
    recipientEmailMasked: direction === "sent" ? row.recipientEmailMasked : null,
    fromName: direction === "received" ? firstNameFromEmail(fromEmail) : null,
    claimable: direction === "received" && status === "funded" && unlocked,
    reclaimable: direction === "sent" && status === "funded" && past,
    shareUrl: direction === "sent" ? giftShareUrl(row.id) : null,
  };
}
