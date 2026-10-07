import { describe, expect, it } from "vitest";
import { anchoredSlippageBps, clearsReviewedFloor } from "./slippage";

const n = (x: number) => BigInt(x);

describe("anchoredSlippageBps", () => {
  it("keeps the person's tolerance when the price hasn't moved", () => {
    // Reviewed 2.70 shares at 0.5%: floor 2.6865. Fresh quote is the same 2.70.
    expect(anchoredSlippageBps({ freshExpectedOut: n(2_700_000), reviewedMinOut: n(2_686_500), slippageBps: 50 })).toBe(50);
  });

  it("tightens the tolerance so the built minimum can't drop below the reviewed floor", () => {
    // Price slipped 0.2% since review: fresh 2.6946, floor 2.6865 leaves 30 bps, not the full 50.
    const fresh = n(2_694_600);
    const reviewedMin = n(2_686_500);
    const bps = anchoredSlippageBps({ freshExpectedOut: fresh, reviewedMinOut: reviewedMin, slippageBps: 50 })!;
    expect(bps).toBeLessThan(50);
    expect((fresh * (n(10_000) - n(bps))) / n(10_000) >= reviewedMin).toBe(true);
  });

  it("refuses when the pool moved ~10% between the review and the build", () => {
    // The scenario from the report: reviewed 2.70, fresh 2.43, tolerance 0.5%.
    expect(anchoredSlippageBps({ freshExpectedOut: n(2_430_000), reviewedMinOut: n(2_686_500), slippageBps: 50 })).toBeNull();
  });

  it("refuses when the fresh quote leaves no room at all", () => {
    expect(anchoredSlippageBps({ freshExpectedOut: n(2_686_500), reviewedMinOut: n(2_686_500), slippageBps: 50 })).toBeNull();
    expect(anchoredSlippageBps({ freshExpectedOut: n(0), reviewedMinOut: n(1), slippageBps: 50 })).toBeNull();
  });

  it("leaves the tolerance alone for a caller with no reviewed floor", () => {
    expect(anchoredSlippageBps({ freshExpectedOut: n(5), reviewedMinOut: undefined, slippageBps: 100 })).toBe(100);
  });

  it("never loosens the tolerance when the price moved in the person's favour", () => {
    expect(anchoredSlippageBps({ freshExpectedOut: n(3_000_000), reviewedMinOut: n(2_686_500), slippageBps: 50 })).toBe(50);
  });
});

describe("clearsReviewedFloor", () => {
  it("accepts the floor itself and a wei of rounding, rejects a real drop", () => {
    expect(clearsReviewedFloor(n(2_686_500), n(2_686_500))).toBe(true);
    expect(clearsReviewedFloor(n(2_686_400), n(2_686_500))).toBe(true);
    expect(clearsReviewedFloor(n(2_430_000), n(2_686_500))).toBe(false);
  });
});
