// The gift UI's view of `@/lib/gifts` (owned by gift-chain).
//
// Everything canonical is re-exported from there rather than redeclared, so the
// screens have one import and there is no second definition to drift. What is
// added here is UI-only: the words each state is given on screen, and the
// amounts offered as chips.
export type {
  GiftSummary as Gift,
  GiftPreview,
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
  GIFT_MIN_UNLOCK_DAYS,
  GIFT_MAX_UNLOCK_YEARS,
  GIFT_RECLAIM_GRACE_DAYS,
  giftContractFor,
  looksLikeEmail,
  maskEmail,
  normalizeEmail,
} from "@/lib/gifts";

import type { GiftStatus } from "@/lib/gifts";

/** A holding as the give flow knows it, before anything is bought. */
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

/** Which pill a gift wears right now. */
export function pillFor(gift: { status: GiftStatus; claimable?: boolean }): GiftPill {
  switch (gift.status) {
    case "pending":
      return "preparing";
    case "claimed":
      return "claimed";
    case "reclaimed":
      return "returned";
    case "failed":
      return "failed";
    default:
      return gift.claimable ? "ready" : "waiting";
  }
}

/** Amounts offered as one-tap chips in the give flow. */
export const GIFT_AMOUNTS = [50, 100, 250, 500] as const;
