// plainCopy — testable sentences for the BSC design-simplicity pass. Screens read strings out
// of these functions instead of formatting a number inline, so the wording (and the threshold
// under which a gap reads as "same as the real share") lives in one tested place.
import { describe, expect, it } from "vitest";
import { gapSentence, gapWords, stateLabel, dryRunReceiptRow, venuePickerExplainer, riskLine, shortGapLine, gapToRealShare, closedBuyLabel, planOpenIssuerNote, trustLine, holdingWords } from "./plainCopy";
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

  it("names the issuer when it trades outside US market hours, so it can't contradict a 'closed' header", () => {
    expect(stateLabel({ state: "overnight", buyable: true, nextOpenMs: null, platformLabel: "Ondo" })).toBe(
      "Open now through Ondo",
    );
    expect(stateLabel({ state: "premarket", buyable: true, nextOpenMs: null, platformLabel: "Ondo" })).toBe(
      "Open now through Ondo",
    );
  });

  it("stays a plain 'Open now' during the regular session", () => {
    expect(stateLabel({ state: "open", buyable: true, nextOpenMs: null, platformLabel: "bStock" })).toBe("Open now");
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

  it("names Stax's pick — the buyable one that costs less against the real share", () => {
    // Design critique P1 #7: one rule for "best", said the way a buyer thinks about it.
    expect(venuePickerExplainer(2, "ondo")).toBe(
      "Two companies make a token for this share. Stax picks the one you can buy now that costs less compared with the real share. Tap to choose the other.",
    );
    expect(venuePickerExplainer(2, "ondo", { buyable: true, state: "open" })).toBe(
      "Two companies make a token for this share. Stax picks the one you can buy now that costs less compared with the real share. Tap to choose the other.",
    );
  });

  it("doesn't invite a tap on the other one while it's paused", () => {
    expect(venuePickerExplainer(2, "ondo", { buyable: false, state: "paused" })).toBe(
      "Two companies make a token for this share. Stax picks the one you can buy now that costs less compared with the real share. The other one is paused right now.",
    );
  });

  it("says the other one is closed when it's simply outside its hours", () => {
    expect(venuePickerExplainer(2, "ondo", { buyable: false, state: "closed" })).toBe(
      "Two companies make a token for this share. Stax picks the one you can buy now that costs less compared with the real share. The other one is closed right now.",
    );
  });

  it("doesn't claim to pick 'the one that's open' when neither venue is open", () => {
    expect(venuePickerExplainer(2, null)).toBe(
      "Two companies make a token for this share, but neither is open right now. Tap to see the other one's price.",
    );
  });
});

describe("dryRunReceiptRow", () => {
  const base: DryRun = { status: "passed", checkedAt: 0 };

  it("says nothing until a check has actually run", () => {
    expect(dryRunReceiptRow(undefined)).toBeNull();
  });

  it("says nothing when the check was skipped, never claiming one happened", () => {
    expect(dryRunReceiptRow({ ...base, status: "skipped" })).toBeNull();
  });

  it("confirms the check when Binance's simulate passed", () => {
    expect(dryRunReceiptRow(base)).toBe("Checked with Binance before it was sent");
  });

  it("has no line for a failed check, because that trade is never sent", () => {
    expect(dryRunReceiptRow({ ...base, status: "failed", reason: "x" })).toBeNull();
  });
});

describe("shortGapLine", () => {
  it("says nothing for an ordinary gap under 0.5%", () => {
    expect(shortGapLine(0.49)).toBe("");
    expect(shortGapLine(-0.3)).toBe("");
    expect(shortGapLine(null)).toBe("");
  });

  it("reads a real premium or discount as one short clause for a Market row", () => {
    expect(shortGapLine(0.6)).toBe("0.6% above the real price");
    expect(shortGapLine(-0.62)).toBe("0.6% below the real price");
    expect(shortGapLine(0.5)).toBe("0.5% above the real price");
  });
});

describe("gapToRealShare", () => {
  it("is the short per-stock clause Plan and Trade put next to the issuer", () => {
    expect(gapToRealShare(-0.2)).toBe("0.2% below the real share");
    expect(gapToRealShare(1.24)).toBe("1.2% above the real share");
  });

  it("calls a tiny gap the same price", () => {
    expect(gapToRealShare(0.04)).toBe("same price as the real share");
    expect(gapToRealShare(null)).toBe("");
  });
});

describe("riskLine", () => {
  it("warns a leveraged fund moves about 3x the market", () => {
    expect(riskLine("leveraged")).toBe("Moves about 3× the market each day. It can lose value fast.");
  });

  it("warns a pre-IPO share isn't on an exchange yet", () => {
    expect(riskLine("preipo")).toBe("Not listed on a stock exchange yet. Prices can swing a lot.");
  });

  it("has nothing to say for an ordinary stock", () => {
    expect(riskLine(undefined)).toBe("");
  });
});

// Design critique P2 #15: a paused issuer isn't "Market closed" — the market may be wide open.
describe("closedBuyLabel", () => {
  it("names the issuer that paused", () => {
    expect(closedBuyLabel("paused", "bStock")).toBe("Paused by bStock");
  });

  it("says a closed market plainly", () => {
    expect(closedBuyLabel("closed", "bStock")).toBe("Market closed");
    expect(closedBuyLabel("overnight", "bStock")).toBe("Market closed");
    expect(closedBuyLabel(undefined, undefined)).toBe("Market closed");
  });

  it("says a ticker Binance can't trade isn't available", () => {
    expect(closedBuyLabel("unsupported", "Ondo")).toBe("Not available");
  });
});

// Design critique P1 #10: Plan explains why a plan buys from Ondo while the US market is shut.
describe("planOpenIssuerNote", () => {
  it("names the issuer Vera buys from while the US market is closed", () => {
    expect(planOpenIssuerNote(false, ["ondo", "ondo"])).toBe("The US market is closed. Vera buys from Ondo, which is open now.");
  });

  it("says nothing while the US market is open, or with no issuer on the plan", () => {
    expect(planOpenIssuerNote(true, ["ondo"])).toBe("");
    expect(planOpenIssuerNote(false, [undefined])).toBe("");
    expect(planOpenIssuerNote(undefined, ["ondo"])).toBe("");
  });

  it("names both when the plan uses both", () => {
    expect(planOpenIssuerNote(false, ["bstock", "ondo"])).toBe(
      "The US market is closed. Vera buys from bStock and Ondo, which are open now.",
    );
  });
});

describe("trustLine", () => {
  it("claims a signature and an on-chain record only on the executor path", () => {
    expect(trustLine("plan", true)).toMatch(/sign/);
    expect(trustLine("every", true)).toMatch(/recorded/);
    for (const kind of ["every", "plan", "basket"] as const) {
      expect(trustLine(kind, false)).not.toMatch(/sign|record/i);
      expect(trustLine(kind, false)).toMatch(/Binance/);
    }
  });
});

describe("holdingWords", () => {
  it("calls a stock real shares", () => {
    expect(holdingWords("shares", "NVDA")).toEqual({ quantityRow: "Shares & price", ownership: "Real shares, held by you" });
  });
  it("never calls a coin a share", () => {
    const w = holdingWords("BTCB", "BTCB");
    expect(w.quantityRow).toBe("Amount & price");
    expect(w.ownership).toBe("Held in your account as BTCB");
    expect(JSON.stringify(w)).not.toMatch(/share/i);
  });
});
