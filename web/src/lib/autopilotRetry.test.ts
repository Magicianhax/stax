// The retry policy is the difference between a bad minute and a skipped week,
// so the rule that decides "try again" is pinned here rather than assumed.
import { describe, expect, it } from "vitest";
import { isPermanent } from "@/lib/autopilotRetry";

describe("autopilot retry policy", () => {
  it("does not retry a plan the person has to fix", () => {
    for (const reason of [
      "Basket risk above your ceiling",
      "Basket no longer exists",
      "Vera is not authorized for this account",
      "Insufficient USDC balance",
      "Not enough cash for this run",
      "Capped at $50.00 per period",
    ]) {
      expect(isPermanent(reason), reason).toBe(true);
    }
  });

  it("retries anything that might just be a bad moment", () => {
    for (const reason of [
      "Run reverted (tx 0xabc).",
      "HTTP request failed",
      "bundler timeout",
      "UserOperation reverted",
      undefined,
    ]) {
      expect(isPermanent(reason), String(reason)).toBe(false);
    }
  });
});
