// Pure extraction rules around /api/swap-quote's error body. TradeScreen has to show a real
// refusal ("NVDA is closed right now…", "below Binance's $6 minimum") rather than the quote
// silently going blank — quoteErrorMessage is what turns a react-query error (or an absent
// one) into that string, so the surfacing behaviour is a plain Node test, not something only
// visible by clicking through the UI.
import { describe, expect, it } from "vitest";
import { assertDryRunAllowsSend, quoteErrorMessage, swapQuoteErrorMessage } from "./swapQuote";
import type { DryRun } from "./dryRun";

describe("swapQuoteErrorMessage", () => {
  it("uses the server's own message when the body has one", () => {
    expect(swapQuoteErrorMessage({ error: "NVDA is closed right now; it opens Mon 9:30 AM." })).toBe(
      "NVDA is closed right now; it opens Mon 9:30 AM.",
    );
  });

  it("falls back when the body has no string error field", () => {
    expect(swapQuoteErrorMessage(null)).toBe("Couldn't get a price right now.");
    expect(swapQuoteErrorMessage({})).toBe("Couldn't get a price right now.");
    expect(swapQuoteErrorMessage({ error: 42 })).toBe("Couldn't get a price right now.");
  });

  it("accepts a custom fallback", () => {
    expect(swapQuoteErrorMessage({}, "No price available.")).toBe("No price available.");
  });
});

describe("quoteErrorMessage", () => {
  it("reads the message off a real Error", () => {
    expect(quoteErrorMessage(new Error("below Binance's $6 minimum"))).toBe("below Binance's $6 minimum");
  });

  it("is undefined for no error, or anything that isn't an Error", () => {
    expect(quoteErrorMessage(null)).toBeUndefined();
    expect(quoteErrorMessage(undefined)).toBeUndefined();
    expect(quoteErrorMessage("plain string")).toBeUndefined();
    expect(quoteErrorMessage({ message: "not a real Error instance" })).toBeUndefined();
  });
});

// Binance's dry run is the final word only when it actually ran and said the trade would
// revert. useSwap calls this right before building the UserOp, so a "failed" check can never
// reach sendSponsoredCalls — "skipped" (no approval yet) and "passed" both let the trade go.
describe("assertDryRunAllowsSend", () => {
  it("does nothing when there's no dry run, or it passed or was skipped", () => {
    expect(() => assertDryRunAllowsSend(undefined)).not.toThrow();
    expect(() => assertDryRunAllowsSend({ status: "passed", checkedAt: 0 })).not.toThrow();
    expect(() => assertDryRunAllowsSend({ status: "skipped", reason: "not approved yet", checkedAt: 0 })).not.toThrow();
  });

  it("throws the dry run's own reason when Binance says the trade would revert", () => {
    const failed: DryRun = { status: "failed", reason: "There isn't enough balance to complete this trade.", checkedAt: 0 };
    expect(() => assertDryRunAllowsSend(failed)).toThrow("There isn't enough balance to complete this trade.");
  });

  it("has a calm fallback message when a failed dry run carries no reason", () => {
    expect(() => assertDryRunAllowsSend({ status: "failed", checkedAt: 0 })).toThrow(/wouldn't go through/i);
  });
});
