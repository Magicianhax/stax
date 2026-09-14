// The gift UI's view of `@/lib/gifts` (owned by gift-chain).
//
// Everything canonical is re-exported from there rather than redeclared, so the
// screens have one import and there is no second definition to drift. What is
// added here is UI-only: the words each state is given on screen, and the
// amounts offered as chips.
export type {
  GiftSummary as Gift,
  GiftPreview,
  GiftRecipient,
  GiftRecipientKind,
  GiftStatus,
  GiftToken,
  CreateGiftRequest,
  CreateGiftResponse,
  GiftsListResponse,
  ClaimAuthorisationResponse,
} from "@/lib/gifts";
export {
  GIFT_MIN_USD,
  GIFT_MAX_USD,
  GIFT_NOTE_MAX,
  GIFT_MIN_UNLOCK_MINUTES,
  GIFT_MAX_UNLOCK_YEARS,
  GIFT_RECLAIM_GRACE_DAYS,
  X_USERNAME_MAX,
  giftContractFor,
  looksLikeEmail,
  looksLikeXUsername,
  maskEmail,
  normalizeEmail,
  normalizeXUsername,
  parseGiftRecipient,
  recipientLabel,
} from "@/lib/gifts";

import type { GiftStatus } from "@/lib/gifts";

/**
 * A holding as the give flow knows it, before anything is bought.
 *
 * Deliberately NOT `BasketItem`: that carries a `reason` written for someone
 * investing for themselves, and at least one of them is false for a gift. Safe
 * Dollars reads "a calm cushion that still earns a little", but a gifted safe
 * slice is parked as plain dollars and earns nothing until it is claimed. If a
 * reason line is ever wanted here, source it from something gift-aware and
 * replace it whenever `heldAsCash` is true — `CashSliceNote` is the honest
 * version of that sentence.
 */
export interface GiftItem {
  symbol: string;
  weightPct: number;
}

/**
 * What a gift's state is called on screen. The server's `status` and its
 * `claimable` flag together decide this: a funded gift is "waiting" until its
 * date passes and "ready" after. Never "escrow", "timelock" or "pending" —
 * those are our words, not the giver's.
 */
export type GiftPill = "preparing" | "waiting" | "ready" | "claimed" | "returned" | "failed";

export const GIFT_PILL_LABEL: Record<GiftPill, string> = {
  preparing: "Setting up",
  waiting: "Waiting to unlock",
  ready: "Ready to claim",
  claimed: "Claimed",
  returned: "Returned",
  failed: "Didn't go through",
};

/**
 * Which pill a gift wears right now.
 *
 * `claimable` is only ever true on a gift the caller received, so on the giver's side the
 * unlock date decides it. Without that a sent gift past its date read "Waiting to unlock ·
 * Ready now", contradicting itself.
 */
export function pillFor(
  gift: { status: GiftStatus; claimable?: boolean; direction?: "sent" | "received"; unlockAt?: string },
  nowMs: number = Date.now(),
): GiftPill {
  switch (gift.status) {
    case "pending":
      return "preparing";
    case "claimed":
      return "claimed";
    case "reclaimed":
      return "returned";
    case "failed":
      return "failed";
    default: {
      if (gift.claimable) return "ready";
      const at = gift.direction === "sent" && gift.unlockAt ? Date.parse(gift.unlockAt) : NaN;
      return Number.isFinite(at) && at <= nowMs ? "ready" : "waiting";
    }
  }
}

/** Amounts offered as one-tap chips in the give flow. */
export const GIFT_AMOUNTS = [50, 100, 250, 500] as const;
