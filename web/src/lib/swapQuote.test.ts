// Pure extraction rules around /api/swap-quote's error body. TradeScreen has to show a real
// refusal ("NVDA is closed right now…", "below Binance's $6 minimum") rather than the quote
// silently going blank — quoteErrorMessage is what turns a react-query error (or an absent
// one) into that string, so the surfacing behaviour is a plain Node test, not something only
// visible by clicking through the UI.
import { describe, expect, it } from "vitest";
import { quoteErrorMessage, swapQuoteErrorMessage } from "./swapQuote";

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
