// plainCopy — testable sentences for the BSC design-simplicity pass. Screens read strings out
// of these functions instead of formatting a number inline, so the wording (and the threshold
// under which a gap reads as "same as the real share") lives in one tested place.
import { describe, expect, it } from "vitest";
import { gapSentence, gapWords, stateLabel, dryRunLine, venuePickerExplainer } from "./plainCopy";
import type { DryRun } from "./dryRun";

describe("gapSentence", () => {
  it("reads a premium as a plain sentence with the real share's price", () => {
    expect(gapSentence(0.4, 180.7)).toBe("You pay 0.40% more than the real share ($180.70)");
  });

  it("reads a discount as 'less', not a negative number", () => {
    expect(gapSentence(-0.12, 180.7)).toBe("You pay 0.12% less than the real share ($180.70)");
  });

  it("calls anything under 0.05% the same price, in either direction", () => {
    expect(gapSentence(0.04, 180.7)).toBe("Same as the real share");
    expect(gapSentence(-0.01, 180.7)).toBe("Same as the real share");
    expect(gapSentence(0, 180.7)).toBe("Same as the real share");
  });

  it("has nothing to say when there is no usable reference price", () => {
    expect(gapSentence(null, 180.7)).toBe("");
  });
});

describe("gapWords", () => {
  it("is the short clause used under a venue's name, no price attached", () => {
    expect(gapWords(0.4)).toBe("0.40% more than the real share");
    expect(gapWords(-0.12)).toBe("0.12% less than the real share");
    expect(gapWords(0.02)).toBe("Same as the real share");
    expect(gapWords(null)).toBe("");
  });
});

describe("stateLabel", () => {
  it("says a tradeable venue is open now, regardless of the session name", () => {
    expect(stateLabel({ state: "overnight", buyable: true, nextOpenMs: null })).toBe("Open now");
  });

  it("names the platform on a pause, never the jargon 'paused'", () => {
    expect(
      stateLabel({ state: "paused", buyable: false, nextOpenMs: null, platformLabel: "Ondo" }),
    ).toBe("Paused by Ondo for now");
  });

  it("falls back to a plain pause line without a platform label", () => {
    expect(stateLabel({ state: "paused", buyable: false, nextOpenMs: null })).toBe("Paused for now");
  });

  it("still calls it a pause, not a closed-until-a-clock-time, when a next-open instant IS set", () => {
    // rwaCatalog.ts's buildVenue always fills `nextOpenMs` for a non-buyable venue —
    // `nextOpenMsFor` never returns null — so a real paused row never hits the `null` case above.
    // Reviewer follow-up: this fixture (a realistic paused row with a next-open instant) is the
    // one the `null`-only branch above can't catch.
    const now = new Date(2026, 8, 24, 12, 0, 0).getTime();
    const next = new Date(2026, 8, 25, 9, 30, 0).getTime();
    expect(
      stateLabel({ state: "paused", buyable: false, nextOpenMs: next, platformLabel: "Ondo", nowMs: now }),
    ).toBe("Paused by Ondo for now");
  });

  it("says a ticker Binance doesn't carry can't be bought here", () => {
    expect(stateLabel({ state: "unsupported", buyable: false, nextOpenMs: null })).toBe("Can't be bought here");
  });

  it("gives a closed venue the one shared local-time formatter", () => {
    const now = new Date(2026, 8, 24, 8, 0, 0).getTime();
    const next = new Date(2026, 8, 24, 18, 30, 0).getTime();
    expect(stateLabel({ state: "closed", buyable: false, nextOpenMs: next, nowMs: now })).toBe(
      "Closed · opens 6:30 PM your time",
    );
  });

  it("reads plain 'Closed' when even the fallback US calendar has no next-open instant", () => {
    expect(stateLabel({ state: "closed", buyable: false, nextOpenMs: null })).toBe("Closed");
  });
});

describe("venuePickerExplainer", () => {
  it("says nothing when the ticker only ever has one venue to show", () => {
    // AMZN has no twin, and a ticker whose twin is missing from /tokens (AAPL/AAPLB) renders one
    // row too — the "Two companies make a token..." promise reads as a broken promise on both
    // (reviewer follow-up on design critique P0 #4).
    expect(venuePickerExplainer(1, "bstock")).toBe("");
    expect(venuePickerExplainer(0, null)).toBe("");
  });

  it("names Stax's pick when at least one venue is buyable", () => {
    expect(venuePickerExplainer(2, "ondo")).toBe(
      "Two companies make a token for this share. Stax picks the one that's open, with the price closest to the real share. Tap to choose the other.",
    );
  });

  it("doesn't claim to pick 'the one that's open' when neither venue is open", () => {
    expect(venuePickerExplainer(2, null)).toBe(
      "Two companies make a token for this share, but neither is open right now. Tap to see the other one's price.",
    );
  });
});

describe("dryRunLine", () => {
  const base: DryRun = { status: "passed", checkedAt: 0 };

  it("reports nothing until a check has actually run", () => {
    expect(dryRunLine(undefined, "0.034", "NVDA")).toEqual({ kind: "none" });
  });

  it("stays quiet when the check was skipped, never claiming one happened", () => {
    expect(dryRunLine({ ...base, status: "skipped" }, "0.034", "NVDA")).toEqual({ kind: "none" });
  });

  it("shows a quiet confirmation line when Binance's simulate passed", () => {
    expect(dryRunLine({ ...base, status: "passed" }, "0.034", "NVDA")).toEqual({
      kind: "quiet",
      text: "Checked with Binance · you'll get about 0.034 NVDA",
    });
  });

  it("surfaces the plain-words reason, and blocks confirming, when the simulate failed", () => {
    expect(
      dryRunLine({ ...base, status: "failed", reason: "The market closed while you were typing." }, "0.034", "NVDA"),
    ).toEqual({ kind: "blocking", text: "The market closed while you were typing." });
  });

  it("falls back to a plain-words reason when a failed check carries none", () => {
    expect(dryRunLine({ ...base, status: "failed" }, "0.034", "NVDA")).toEqual({
      kind: "blocking",
      text: "Binance couldn't confirm this trade would go through.",
    });
  });
});
