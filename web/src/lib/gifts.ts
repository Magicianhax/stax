// "Gift a basket" — the shared shapes both halves of the feature import.
// Client-safe: types, display helpers, the TimelockGift ABI, and the deployed address
// per chain. Nothing here reads a secret; the email hash lives server-side only
// (lib/server/giftsStore.ts) so a browser can never brute-force a recipient.
//
// The flow, end to end (docs/GIFTS.md has the long version):
//   1. splitGiftBasket()          preview the split locally — the SAME function the
//                                 server runs, so the preview cannot disagree with step 2
//   2. POST /api/gifts            reserve the gift row + giftId, get the allocation back
//   3. the normal invest path     tokens land in the GIVER's smart account
//   4. approve + TimelockGift.create   one batched sponsored user op, tokens parked
//   5. POST /api/gifts/:id/funded the server re-reads the contract before believing it
//   6. …later: POST /api/gifts/:id/claim-authorisation → TimelockGift.claim
import { encodeFunctionData } from "viem";
import { ERC20_ABI } from "@/lib/abis";
import { getChain } from "@/lib/chains";
import type { BasketItem } from "@/lib/baskets";
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
/**
 * How far ahead an unlock must be. Minutes, not days: someone should be able to
 * send a birthday gift on the morning of the birthday. The floor exists only so
 * the invest and park transactions can land before the gift is claimable, never
 * to make people wait.
 */
export const GIFT_MIN_UNLOCK_MINUTES = 15;
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

/** X's own rule for a username: 1–15 characters of [A-Za-z0-9_]. */
export const X_USERNAME_MAX = 15;

// ── shapes ───────────────────────────────────────────────────────────────────
export type GiftStatus = "pending" | "funded" | "claimed" | "reclaimed" | "failed";

/**
 * Who a gift is addressed to. Both kinds are answered the same way — the recipient
 * signs in with that identity through Privy and the server checks its OWN Privy user
 * record before it signs a claim — so only the identity check differs, never the
 * storage, the hashes or the contract.
 */
export type GiftRecipientKind = "email" | "x";

/** A recipient in the one normalised form the hashes are ever taken over. */
export type GiftRecipient =
  | { kind: "email"; email: string }
  | { kind: "x"; username: string };

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
  /**
   * True for a slice parked as plain USDC rather than in its usual on-chain form.
   * Today that means the Aave "Safe Dollars" tier: aUSDC rebases, and TimelockGift pays
   * out the amount it recorded rather than the live balance, so parking the aToken would
   * strand every cent of interest it earned while it waited. The recipient can move it
   * into Aave themselves once they have claimed it.
   */
  heldAsCash?: boolean;
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
  /** Which identity this gift is addressed to. Decides the claim check, nothing else. */
  recipientKind: GiftRecipientKind;
  /**
   * Who it's for, as the giver sees it: "a•••@gmail.com" for an email, "@jack" for an X
   * handle. Only on gifts the caller SENT — never on a received gift and never on the
   * public share page, which must not reveal who a gift is for.
   */
  recipientLabel: string | null;
  /** The giver's first name when we can tell. Only on gifts addressed to the caller. */
  fromName: string | null;
  /** True when the caller can claim it right now (received, funded, past the unlock date). */
  claimable: boolean;
  /** True when the caller can take it back right now (sent, funded, past the grace period). */
  reclaimable: boolean;
  /** Absolute link the giver shares with the recipient. Only on gifts the caller sent. */
  shareUrl: string | null;
}

// POST /api/gifts — reserve the gift. Nothing is on-chain yet.
export interface CreateGiftRequest {
  basketId: string;
  amountUsd: number;
  /** Who it's for. `{ kind: "x", username }` addresses it to an X account instead. */
  recipient: GiftRecipient;
  /**
   * The pre-X body shape: a bare email, treated as `{ kind: "email" }`. Still accepted so
   * an older client keeps working; new callers send `recipient`.
   * @deprecated use `recipient`
   */
  recipientEmail?: string;
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
  /**
   * Feed this straight into the normal invest path (POST /api/invest-plan), passing
   * `investUsd` as the amount — NOT the gift's full `amountUsd`. It holds only the legs
   * that are actually bought; any Aave "Safe Dollars" slice has been taken out of it and
   * is parked as USDC instead (see `cashToken`). Null when the basket is all safe dollars
   * and there is nothing to buy at all — skip the invest step entirely in that case.
   */
  allocation: AllocateResult | null;
  /** Dollars going through the executor. Pass THIS to /api/invest-plan, not `amountUsd`. */
  investUsd: number;
  /** Dollars parked straight as USDC. `investUsd + cashUsd === amountUsd`. */
  cashUsd: number;
  /** The USDC slice to park, already in raw 6-decimal units. Null when there is none. */
  cashToken: GiftToken | null;
  /** The full split as shown to people, with the cash-held slices marked. */
  holdings: GiftHolding[];
  basketName: string;
  /** Which identity the gift was addressed to, echoed back. */
  recipientKind: GiftRecipientKind;
  /** Who it's for, as the giver sees it: "a•••@gmail.com" or "@jack". */
  recipientLabel: string;
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

/**
 * "@Jack" → "jack". The one form an X username is hashed, stored or compared in.
 *
 * X usernames are case-insensitive, so lowercasing is what makes "@Jack" on the gift and
 * "jack" on the Privy record the same person. The leading "@" is display sugar people
 * type by habit and never part of the handle itself.
 */
export function normalizeXUsername(username: string): string {
  return username.trim().replace(/^@+/, "").toLowerCase();
}

const X_USERNAME_RE = new RegExp(`^[A-Za-z0-9_]{1,${X_USERNAME_MAX}}$`);

/** X's rule, applied to the normalised form: 1–15 characters of [A-Za-z0-9_]. */
export function looksLikeXUsername(username: string): boolean {
  return X_USERNAME_RE.test(normalizeXUsername(username));
}

/**
 * Normalise and validate a recipient of either kind, or null when it doesn't pass.
 *
 * The one place the two kinds branch on the way IN. Both halves of the feature call it —
 * the give flow to decide whether the step is answered, the API before it hashes — so a
 * handle the screen accepted can never be one the server rejects, and neither can hash a
 * form the other would not have.
 */
export function parseGiftRecipient(input: GiftRecipient): GiftRecipient | null {
  if (input.kind === "x") {
    const username = normalizeXUsername(input.username);
    return looksLikeXUsername(username) ? { kind: "x", username } : null;
  }
  const email = normalizeEmail(input.email);
  return looksLikeEmail(email) ? { kind: "email", email } : null;
}

/**
 * What the GIVER sees on their own gift. An email is masked, because it is private and
 * readable over a shoulder; an X handle is shown whole, because "@jack" is already public.
 * Never on the share page and never on a gift someone received — see GiftSummary.
 */
export function recipientLabel(recipient: GiftRecipient): string {
  return recipient.kind === "x" ? `@${normalizeXUsername(recipient.username)}` : maskEmail(recipient.email);
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

// ── the safe-dollars split ───────────────────────────────────────────────────
/**
 * Aave's "Safe Dollars" (aUSDC) is a REBASING token: its balance grows as interest
 * accrues. TimelockGift records the amount handed to `create` and pays exactly that back
 * at claim or reclaim, so anything a parked aToken earned while it waited — up to 25
 * years of it — would sit in the contract forever with no way out.
 *
 * So a gift never parks the aToken. The safe slice is held as plain USDC: the invest step
 * buys only the other legs, and the dollars for this one go straight into the gift. The
 * recipient can supply them to Aave themselves the moment they claim. Nothing is stranded,
 * every basket stays giftable, and the contract needs no rescue hatch.
 *
 * Everything is computed in raw 6-decimal USDC so the two halves always add back up to
 * the gift's amount exactly, with no float drift.
 */
export interface GiftSplit {
  /** What the executor buys. Weights renormalised to 100. Empty when the basket is all cash. */
  invested: BasketItem[];
  /** Dollars going through the executor. */
  investUsd: number;
  /** Dollars parked straight as USDC. */
  cashUsd: number;
  /** The USDC to park, raw 6-decimal units. Null when the basket holds no safe tier. */
  cashToken: GiftToken | null;
  /** The whole basket as shown to people, cash-held slices marked. */
  holdings: GiftHolding[];
}

/** True for an asset a gift must park as USDC rather than in its own on-chain form. */
export function isHeldAsCash(chain: ChainKey, symbol: string): boolean {
  const asset = getChain(chain).assets.all.find((a) => a.symbol === symbol);
  // `aave_v3` is the only rebasing venue in the registry today. Any future one belongs here.
  return asset?.via === "aave_v3";
}

/** Split a basket into the part the executor buys and the part parked as USDC. */
export function splitGiftBasket(chain: ChainKey, items: BasketItem[], amountUsd: number): GiftSplit {
  const staxChain = getChain(chain);
  const decimals = staxChain.usdc.decimals;
  const totalWeight = items.reduce((sum, i) => sum + Math.max(0, i.weightPct), 0) || 1;

  const cashItems = items.filter((i) => isHeldAsCash(chain, i.symbol));
  const boughtItems = items.filter((i) => !isHeldAsCash(chain, i.symbol));
  const cashWeight = cashItems.reduce((sum, i) => sum + Math.max(0, i.weightPct), 0);

  // Integer maths end to end: the cash slice is floored and the invested slice takes the
  // remainder, so the two always sum back to exactly `amountUsd`.
  const totalRaw = BigInt(Math.round(amountUsd * 10 ** decimals));
  const cashRaw = (totalRaw * BigInt(Math.round((cashWeight / totalWeight) * 10_000))) / BigInt(10_000);
  const investRaw = totalRaw - cashRaw;
  const toUsd = (raw: bigint) => Number(raw) / 10 ** decimals;

  const boughtWeight = boughtItems.reduce((sum, i) => sum + Math.max(0, i.weightPct), 0) || 1;
  return {
    invested: boughtItems.map((i) => ({ ...i, weightPct: (i.weightPct / boughtWeight) * 100 })),
    investUsd: toUsd(investRaw),
    cashUsd: toUsd(cashRaw),
    cashToken:
      cashRaw > BigInt(0)
        ? { symbol: staxChain.usdc.symbol, address: staxChain.usdc.address, amount: cashRaw.toString() }
        : null,
    holdings: items.map((i) => ({
      symbol: i.symbol,
      weightPct: i.weightPct,
      ...(isHeldAsCash(chain, i.symbol) ? { heldAsCash: true } : {}),
    })),
  };
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
 * Fold a token list (plus the cash slice, if any) into one entry per address, amounts summed.
 * `create` would take duplicates, but they would need two approvals and pay out twice.
 *
 * Call this ONCE and use the result everywhere — the approvals, `create`, the `funded` body
 * the server matches against the contract, and anything the success screen shows. A second
 * implementation of the same fold could drift, and the failure would only surface after two
 * on-chain transactions had already happened. Idempotent, so re-merging is harmless.
 */
export function mergeGiftTokens(tokens: GiftToken[], cashToken: GiftToken | null): GiftToken[] {
  const merged: GiftToken[] = [];
  for (const token of cashToken ? [...tokens, cashToken] : tokens) {
    const seen = merged.find((m) => m.address.toLowerCase() === token.address.toLowerCase());
    if (seen) seen.amount = (BigInt(seen.amount) + BigInt(token.amount)).toString();
    else merged.push({ ...token });
  }
  return merged;
}

/**
 * Step 4 of giving: one approval per parked token, then `create`. Send this AFTER the
 * normal invest user op has landed, with `tokens` read from that receipt's `LegFilled`
 * events — the bought amounts are not knowable before execution.
 *
 * `cashToken` may be passed here, but prefer calling `mergeGiftTokens` yourself and handing
 * the result in as `tokens`: the same list has to reach the `funded` report the server
 * matches against the contract, and building it once is what stops the two disagreeing.
 * Either way the fold below is the same function, and it is idempotent — a list that is
 * already merged passes through unchanged, so it can never double-count.
 */
export function giftCreateCalls(input: {
  giftContract: `0x${string}`;
  giftId: `0x${string}`;
  recipientHash: `0x${string}`;
  /** Unix seconds, straight from CreateGiftResponse. */
  unlockAt: number;
  reclaimAfter: number;
  /** What the invest step actually bought, from its `LegFilled` events. */
  tokens: GiftToken[];
  /** The USDC slice held as cash, from CreateGiftResponse. */
  cashToken?: GiftToken | null;
  note: string;
}): GiftCall[] {
  const merged = mergeGiftTokens(input.tokens, input.cashToken ?? null);

  const approvals: GiftCall[] = merged.map((t) => ({
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
          merged.map((t) => t.address),
          merged.map((t) => BigInt(t.amount)),
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
