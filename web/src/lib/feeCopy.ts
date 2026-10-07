// The fee lines on a buy review and receipt. BNB Chain takes no fee (ADR-0007), so there is no Fee
// row to show there; every other chain keeps the row and the "fee included" note.
import type { ChainKey } from "./chains/types";

/** Whether the order review / receipt lists a Fee row on this chain. */
export function showsFeeRow(chainKey: ChainKey): boolean {
  return chainKey !== "bsc";
}

/** The small line under a buy review. Sells never pay a fee on any chain. */
export function reviewFeeNote(chainKey: ChainKey, isSell: boolean): string {
  return isSell || !showsFeeRow(chainKey) ? "No fee · no network cost" : "Fee included · no network cost";
}
