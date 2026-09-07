// "Gift a basket" — the shared shapes both halves of the feature import.
// Client-safe: types, display helpers, the TimelockGift ABI, and the deployed address
// per chain. Nothing here reads a secret; the email hash lives server-side only
// (lib/server/giftsStore.ts) so a browser can never brute-force a recipient.
//
// The flow, end to end (docs/GIFTS.md has the long version):
//   1. POST /api/gifts/quote      preview the split, no writes, no auth
//   2. POST /api/gifts            reserve the gift row + giftId, get the allocation back
//   3. the normal invest path     tokens land in the GIVER's smart account
//   4. approve + TimelockGift.create   one batched sponsored user op, tokens parked
//   5. POST /api/gifts/:id/funded the server re-reads the contract before believing it
//   6. …later: POST /api/gifts/:id/claim-authorisation → TimelockGift.claim
import { encodeFunctionData } from "viem";
import { ERC20_ABI } from "@/lib/abis";
import type { ChainKey } from "@/lib/chains/types";
import type { AllocateResult } from "@/lib/invest-types";

// ── rules (the API enforces these; the UI should show them) ───────────────────
/** Smallest gift, in dollars. Below this the swap fees eat the present. */
export const GIFT_MIN_USD = 5;
/** Largest gift, in dollars. */
export const GIFT_MAX_USD = 100_000;
/** A note is shown verbatim to the recipient; the contract rejects anything longer. */
export const GIFT_NOTE_MAX = 200;
/** An unlock date must be at least this far out — a gift is a wait, not a transfer. */
export const GIFT_MIN_UNLOCK_DAYS = 1;
/** …and at most this far out. */
export const GIFT_MAX_UNLOCK_YEARS = 25;
/** How long after the unlock date the giver must wait before they may take it back. */
export const GIFT_RECLAIM_GRACE_DAYS = 90;

/** Chains the gift contract is deployed on. Base only for now. */
export const GIFT_CHAINS: ChainKey[] = ["base"];

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const GIFT_ADDRESSES: Record<ChainKey, `0x${string}`> = {
  base: (process.env.NEXT_PUBLIC_STAX_GIFT_BASE || ZERO) as `0x${string}`,
  mantle: ZERO,
};

/** The TimelockGift address on `chain`, or null when gifting isn't live there. */
export function giftContractFor(chain: ChainKey): `0x${string}` | null {
  const address = GIFT_ADDRESSES[chain];
  return address && address !== ZERO ? address : null;
}

// ── shapes ───────────────────────────────────────────────────────────────────
export type GiftStatus = "pending" | "funded" | "claimed" | "reclaimed" | "failed";

/** One parked holding. `amount` is raw token units as a decimal string (never a number). */
export interface GiftToken {
  symbol: string;
  address: `0x${string}`;
  amount: string;
}

/**
 * The basket's split as it was on the day the gift was given, snapshotted onto the row.
 * Weights are not sensitive — a curated basket's are already public in lib/baskets.ts —
 * so these ride along on the PUBLIC preview and draw its asset tiles. Amounts never do.
 */
export interface GiftHolding {
  symbol: string;
  weightPct: number;
}

/** A gift as the app shows it. `direction` says which side of it the caller is on. */
export interface GiftSummary {
  /** The on-chain giftId — 0x + 32 bytes. Also the database row id and the share link. */
  id: `0x${string}`;
  chain: ChainKey;
  direction: "sent" | "received";
  status: GiftStatus;
  basketId: string | null;
  basketName: string;
  amountUsd: number;
  note: string | null;
  /** ISO timestamps. */
  unlockAt: string;
  reclaimAfter: string;
  createdAt: string;
  tokens: GiftToken[];
  /** The basket's split as given. Empty only for rows written before the snapshot existed. */
  holdings: GiftHolding[];
  createTxHash: string | null;
  claimTxHash: string | null;
  /** Masked recipient ("a•••@gmail.com"). Only on gifts the caller sent. */
  recipientEmailMasked: string | null;
  /** The giver's first name when we can tell. Only on gifts addressed to the caller. */
  fromName: string | null;
  /** True when the caller can claim it right now (received, funded, past the unlock date). */
  claimable: boolean;
  /** True when the caller can take it back right now (sent, funded, past the grace period). */
  reclaimable: boolean;
  /** Absolute link the giver shares with the recipient. Only on gifts the caller sent. */
  shareUrl: string | null;
}

// POST /api/gifts/quote — public preview of the split. No writes.
export interface GiftQuoteRequest {
  basketId: string;
  amountUsd: number;
}
export interface GiftQuoteResponse {
  basket: { id: string; name: string; tagline: string; icon: string; color: string; riskScore: number };
  allocation: AllocateResult;
}

// POST /api/gifts — reserve the gift. Nothing is on-chain yet.
export interface CreateGiftRequest {
  basketId: string;
  amountUsd: number;
  recipientEmail: string;
  /** ISO date/time the recipient may claim from. */
  unlockAt: string;
  note?: string;
}
export interface CreateGiftResponse {
  giftId: `0x${string}`;
  chain: ChainKey;
  /** TimelockGift on `chain` — the approve target and the `create` callee. */
  giftContract: `0x${string}`;
  /** What goes on-chain in place of the email. Opaque to the client. */
  recipientHash: `0x${string}`;
  /** Unix SECONDS, for the contract call. */
  unlockAt: number;
  reclaimAfter: number;
  /** The same two as ISO, for display. */
  unlockAtIso: string;
  reclaimAfterIso: string;
  /** Pass this string to `create` unchanged — the server has already trimmed and capped it. */
  note: string;
  /** Feed this straight into the normal invest path (POST /api/invest-plan). */
  allocation: AllocateResult;
  basketName: string;
  recipientEmailMasked: string;
  shareUrl: string;
}

// POST /api/gifts/:id/funded — tell the server the parking transaction landed.
export interface FundGiftRequest {
  txHash: `0x${string}`;
  tokens: GiftToken[];
}
export interface FundGiftResponse {
  gift: GiftSummary;
}

// GET /api/gifts
export interface GiftsListResponse {
  sent: GiftSummary[];
  received: GiftSummary[];
}

// POST /api/gifts/:id/claim-authorisation — the server attests the caller owns the email.
export interface ClaimAuthorisationResponse {
  giftContract: `0x${string}`;
  giftId: `0x${string}`;
  /** The caller's own smart account. Never send the gift anywhere else. */
  to: `0x${string}`;
  /** Unix SECONDS. Short-lived (10 minutes) — re-request if the user hesitates. */
  deadline: number;
  signature: `0x${string}`;
  gift: GiftSummary;
}

// POST /api/gifts/:id/claimed — record the claim transaction.
export interface ClaimedGiftRequest {
  txHash: `0x${string}`;
}

/** GET /api/gifts/preview?id= — PUBLIC. No email, no addresses, no token amounts. */
export interface GiftPreview {
  id: `0x${string}`;
  chain: ChainKey;
  basketName: string;
  amountUsd: number;
  note: string | null;
  unlockAt: string;
  fromName: string | null;
  status: GiftStatus;
  claimable: boolean;
  /** What the basket holds, for the public page's asset tiles. Never any amounts. */
  holdings: GiftHolding[];
}

// ── display helpers ──────────────────────────────────────────────────────────
/** Lowercased, trimmed — the one form the hash is ever taken over. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Good enough to reject typos; the real check is that the recipient can sign in with it. */
export function looksLikeEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length >= 6 && e.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e);
}

/**
 * "alex@gmail.com" → "a•••@gmail.com". What the giver sees on their own gift, so they can
 * tell two recipients apart without the address being readable over someone's shoulder.
 */
export function maskEmail(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}•••@${domain}`;
}

/** Whole days from now until `iso`, rounded up. Negative once the date has passed. */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

/** The unlock date's plain-words countdown: "opens in 8 months", "opens tomorrow", "open now". */
export function unlockLabel(iso: string, now = Date.now()): string {
  const days = daysUntil(iso, now);
  if (days <= 0) return "open now";
  if (days === 1) return "opens tomorrow";
  if (days < 31) return `opens in ${days} days`;
  const months = Math.round(days / 30.4);
  if (months < 24) return `opens in ${months} month${months === 1 ? "" : "s"}`;
  return `opens in ${Math.round(days / 365)} years`;
}

// ── call builders ────────────────────────────────────────────────────────────
// The exact batches to hand `sendSponsoredCalls`. Encoding lives here rather than in a
// screen so the ABI, the argument order and the bigint conversions have one home. Shape
// is structurally the `Call` from lib/aa.ts, so the arrays drop straight in.
export interface GiftCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
}

/**
 * Step 4 of giving: one approval per parked token, then `create`. Send this AFTER the
 * normal invest user op has landed, with `tokens` read from that receipt's `LegFilled`
 * events — the bought amounts are not knowable before execution.
 */
export function giftCreateCalls(input: {
  giftContract: `0x${string}`;
  giftId: `0x${string}`;
  recipientHash: `0x${string}`;
  /** Unix seconds, straight from CreateGiftResponse. */
  unlockAt: number;
  reclaimAfter: number;
  tokens: GiftToken[];
  note: string;
}): GiftCall[] {
  const approvals: GiftCall[] = input.tokens.map((t) => ({
    to: t.address,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [input.giftContract, BigInt(t.amount)] }),
  }));
  return [
    ...approvals,
    {
      to: input.giftContract,
      data: encodeFunctionData({
        abi: TIMELOCK_GIFT_ABI,
        functionName: "create",
        args: [
          input.giftId,
          input.recipientHash,
          BigInt(input.unlockAt),
          BigInt(input.reclaimAfter),
          input.tokens.map((t) => t.address),
          input.tokens.map((t) => BigInt(t.amount)),
          input.note,
        ],
      }),
    },
  ];
}

/** Claiming: one call, built straight from the claim-authorisation response. */
export function giftClaimCall(auth: ClaimAuthorisationResponse): GiftCall {
  return {
    to: auth.giftContract,
    data: encodeFunctionData({
      abi: TIMELOCK_GIFT_ABI,
      functionName: "claim",
      args: [auth.giftId, auth.to, BigInt(auth.deadline), auth.signature],
    }),
  };
}

/** The giver taking an unclaimed gift back. Only valid once `reclaimable` is true. */
export function giftReclaimCall(giftContract: `0x${string}`, giftId: `0x${string}`): GiftCall {
  return {
    to: giftContract,
    data: encodeFunctionData({ abi: TIMELOCK_GIFT_ABI, functionName: "reclaim", args: [giftId] }),
  };
}

// ── ABI ──────────────────────────────────────────────────────────────────────
/** TimelockGift — only what the app calls or reads. Mirrors contracts/TimelockGift.sol. */
export const TIMELOCK_GIFT_ABI = [
  {
    type: "function",
    name: "create",
    stateMutability: "nonpayable",
    inputs: [
      { name: "giftId", type: "bytes32" },
      { name: "recipientHash", type: "bytes32" },
      { name: "unlockAt", type: "uint64" },
      { name: "reclaimAfter", type: "uint64" },
      { name: "tokens", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "note", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "giftId", type: "bytes32" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reclaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "giftId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getGift",
    stateMutability: "view",
    inputs: [{ name: "giftId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "recipientHash", type: "bytes32" },
          { name: "unlockAt", type: "uint64" },
          { name: "reclaimAfter", type: "uint64" },
          { name: "claimed", type: "bool" },
          { name: "tokens", type: "address[]" },
          { name: "amounts", type: "uint256[]" },
          { name: "note", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isClaimable",
    stateMutability: "view",
    inputs: [{ name: "giftId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "signer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "GiftCreated",
    inputs: [
      { name: "giftId", type: "bytes32", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "recipientHash", type: "bytes32", indexed: true },
      { name: "unlockAt", type: "uint64", indexed: false },
      { name: "reclaimAfter", type: "uint64", indexed: false },
      { name: "tokenCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GiftClaimed",
    inputs: [
      { name: "giftId", type: "bytes32", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GiftReclaimed",
    inputs: [
      { name: "giftId", type: "bytes32", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "tokenCount", type: "uint256", indexed: false },
    ],
  },
] as const;
