import { describe, expect, it } from "vitest";
import { reviewFeeNote, showsFeeRow } from "./feeCopy";

describe("fee copy", () => {
  it("BNB Chain has no Fee row", () => {
    expect(showsFeeRow("bsc")).toBe(false);
  });

  it("Base and Mantle keep the Fee row", () => {
    expect(showsFeeRow("base")).toBe(true);
    expect(showsFeeRow("mantle")).toBe(true);
  });

  it("says 'No fee' on BNB Chain for buys and sells, the same as the plan screen", () => {
    expect(reviewFeeNote("bsc", false)).toBe("No fee · no network cost");
    expect(reviewFeeNote("bsc", true)).toBe("No fee · no network cost");
  });

  it("keeps 'Fee included' for a buy elsewhere, and 'No fee' for a sell", () => {
    expect(reviewFeeNote("base", false)).toBe("Fee included · no network cost");
    expect(reviewFeeNote("base", true)).toBe("No fee · no network cost");
  });
});
