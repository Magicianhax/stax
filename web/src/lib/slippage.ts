// Anchors the slippage a swap is BUILT with to the price the person actually reviewed.
//
// The Trade screen quotes once for display; the swap is built from a second, fresh quote up to
// ~15 s later, and the router's minimum is that fresh quote minus the person's tolerance. If a
// thin pool moved 10% in between, a "0.5% tolerance" trade still went through at a fill 10% worse
// than the review sheet showed. Anchoring the tolerance to the reviewed floor (reviewed expected
// output minus tolerance) makes the number on the sheet the real guarantee: the swap is built so
// its minimum is never below that floor, or it is refused and the person reviews again.
const BPS = BigInt(10_000);

export const PRICE_MOVED_MESSAGE = "The price moved since you looked. Check the new price and try again.";

/** The built swap would have filled below the reviewed floor, so nothing was sent. A refusal, not a failed trade. */
export class PriceMovedError extends Error {
  constructor() {
    super(PRICE_MOVED_MESSAGE);
    this.name = "PriceMovedError";
  }
}

/**
 * The slippage (whole basis points) to build the swap with: the person's tolerance, tightened so
 * `freshExpectedOut * (1 - result)` is never below `reviewedMinOut`. Null when the fresh quote
 * already sits at or under the reviewed floor, or leaves no room for even 1 bp, meaning the price
 * has moved more than the tolerance since review and the trade must not be sent.
 * No reviewed floor (an older client) leaves the tolerance untouched.
 */
export function anchoredSlippageBps(p: {
  freshExpectedOut: bigint;
  reviewedMinOut: bigint | undefined;
  slippageBps: number;
}): number | null {
  if (p.reviewedMinOut === undefined) return p.slippageBps;
  if (p.freshExpectedOut <= BigInt(0) || p.freshExpectedOut <= p.reviewedMinOut) return null;
  const room = Number(((p.freshExpectedOut - p.reviewedMinOut) * BPS) / p.freshExpectedOut);
  const bps = Math.min(p.slippageBps, room);
  return bps >= 1 ? bps : null;
}

/**
 * Client-side backstop for the server's anchoring: is the built swap's minimum still at (or
 * within a basis point of rounding of) the floor the person reviewed?
 */
export function clearsReviewedFloor(builtMinOut: bigint, reviewedMinOut: bigint): boolean {
  return builtMinOut >= reviewedMinOut - reviewedMinOut / BigInt(10_000);
}
