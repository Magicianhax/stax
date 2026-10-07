// Pure extraction rules around /api/swap-quote's error body. TradeScreen has to show a real
// refusal ("NVDA is closed right now…", "below Binance's $6 minimum") rather than the quote
// silently going blank — quoteErrorMessage is what turns a react-query error (or an absent
// one) into that string, so the surfacing behaviour is a plain Node test, not something only
// visible by clicking through the UI.
import { describe, expect, it } from "vitest";
import { assertDryRunAllowsSend, quoteErrorMessage, quoteProblemText, swapQuoteErrorFrom, swapQuoteErrorMessage, SwapQuoteError } from "./swapQuote";
import { formatOpensLocal } from "./marketHours";
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

// swapQuoteErrorFrom / quoteProblemText — design critique P0 #3: raw server and Binance text
// ("Binance returned an RFQ route", "No swap route for NVDA", "The aggregator changed the swap
// amount") reached the Trade banner verbatim. Only refusals the person can act on keep their
// own words; everything else becomes one plain sentence naming the company and the issuer.
describe("swapQuoteErrorFrom", () => {
  it("carries the server's machine-readable code and next-open instant", () => {
    const err = swapQuoteErrorFrom({ error: "NVDA is closed right now", code: "closed", nextOpenMs: 123 }, 409);
    expect(err).toBeInstanceOf(SwapQuoteError);
    expect(err.code).toBe("closed");
    expect(err.nextOpenMs).toBe(123);
    expect(err.message).toBe("NVDA is closed right now");
  });

  it("treats any 429 as the per-user price-check limit, code or not", () => {
    expect(swapQuoteErrorFrom({ error: "Too many requests." }, 429).code).toBe("rate_limited");
  });

  it("has no code for an unrecognised or missing one", () => {
    expect(swapQuoteErrorFrom({ error: "x", code: "whatever" }, 400).code).toBeUndefined();
    expect(swapQuoteErrorFrom(null, 502).code).toBeUndefined();
  });
});

describe("quoteProblemText", () => {
  const nvdaBsc = { bsc: true, companyName: "Nvidia", issuer: "bStock", otherIssuer: "Ondo", side: "buy" as const };

  it("is undefined when there's no error at all", () => {
    expect(quoteProblemText(undefined, nvdaBsc)).toBeUndefined();
    expect(quoteProblemText("nope", nvdaBsc)).toBeUndefined();
  });

  it("keeps the $6 minimum's own words", () => {
    const err = new SwapQuoteError("The smallest trade is $6. Enter $6 or more.", "min_trade");
    expect(quoteProblemText(err, nvdaBsc)).toBe("The smallest trade is $6. Enter $6 or more.");
  });

  it("keeps 'the price moved' as the server wrote it, so Trade asks for a fresh look", () => {
    const err = swapQuoteErrorFrom({ error: "The price moved since you looked. Check the new price and try again.", code: "price_moved" }, 400);
    expect(err.code).toBe("price_moved");
    expect(quoteProblemText(err, nvdaBsc)).toMatch(/price moved/);
  });

  it("says a closed market in the viewer's own clock, never the server's ET sentence", () => {
    const now = new Date(2026, 8, 26, 12, 0, 0).getTime();
    const next = new Date(2026, 8, 28, 18, 30, 0).getTime();
    const err = new SwapQuoteError("NVDA is closed right now; it opens Mon 9:30am ET.", "closed", next);
    expect(quoteProblemText(err, { ...nvdaBsc, nowMs: now })).toBe(`Nvidia is closed right now. It ${formatOpensLocal(next, now)}.`);
  });

  it("reads the per-user limit as a short wait", () => {
    expect(quoteProblemText(new SwapQuoteError("Too many requests.", "rate_limited"), nvdaBsc)).toBe(
      "Too many price checks — wait a few seconds",
    );
  });

  it.each([
    "NVDA: Binance returned an RFQ route, which a contract can't sign.",
    "NVDA: Binance quoted an unexpected router.",
    "No swap route for NVDA on BNB Chain right now.",
    "The aggregator changed the swap amount. Please try again.",
    "Amount too small.",
    "This trade needs one more approval step first.",
  ])("turns uncoded server text into one plain sentence: %s", (raw) => {
    expect(quoteProblemText(new Error(raw), nvdaBsc)).toBe(
      "We can't buy Nvidia from bStock right now. Try Ondo, or try again in a few minutes.",
    );
  });

  it("treats a 'closed' refusal with no next-open time like any other problem", () => {
    expect(quoteProblemText(new SwapQuoteError("closed", "closed"), nvdaBsc)).toBe(
      "We can't buy Nvidia from bStock right now. Try Ondo, or try again in a few minutes.",
    );
  });

  it("leaves out the other issuer when there isn't one", () => {
    expect(quoteProblemText(new Error("x"), { ...nvdaBsc, otherIssuer: undefined })).toBe(
      "We can't buy Nvidia from bStock right now. Try again in a few minutes.",
    );
  });

  it("says sell for a sell", () => {
    expect(quoteProblemText(new Error("x"), { ...nvdaBsc, side: "sell" })).toBe(
      "We can't sell Nvidia through bStock right now. Try again in a few minutes.",
    );
  });

  it("keeps a generic equivalent off BSC, with no issuer to name", () => {
    expect(quoteProblemText(new Error("No swap route for NVDA on Base right now."), { bsc: false, companyName: "Nvidia", side: "buy" })).toBe(
      "We can't get a price for Nvidia right now. Try again in a few minutes.",
    );
  });
});
