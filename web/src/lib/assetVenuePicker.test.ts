import { describe, expect, it } from "vitest";
import { chosenVenueFor, otherOpenVenue } from "./assetVenuePicker";

const venues = [
  { platform: "bstock" as const, buyable: true },
  { platform: "ondo" as const, buyable: true },
];

describe("chosenVenueFor", () => {
  it("opens on the issuer the screen was opened with, before any tap on the panel", () => {
    // Regression: a "Which is cheaper?" board row for a ticker where Ondo is cheaper must land
    // the viewer on Ondo, not silently fall back to the catalog's own best-venue pick.
    expect(chosenVenueFor(undefined, "ondo", venues, "bstock")).toBe("ondo");
  });

  it("an explicit tap on the panel overrides the opened venue", () => {
    expect(chosenVenueFor("bstock", "ondo", venues, "bstock")).toBe("bstock");
  });

  it("falls back to the default venue when the opened venue isn't buyable", () => {
    const paused = [{ platform: "bstock" as const, buyable: true }, { platform: "ondo" as const, buyable: false }];
    expect(chosenVenueFor(undefined, "ondo", paused, "bstock")).toBe("bstock");
  });

  it("falls back to the default venue with no opened venue and no pick", () => {
    expect(chosenVenueFor(undefined, undefined, venues, "bstock")).toBe("bstock");
  });

  it("fails closed to the default venue before the catalog has answered (no venues yet)", () => {
    expect(chosenVenueFor(undefined, "ondo", undefined, "bstock")).toBe("bstock");
  });
});

// Design critique P1 #9: when the issuer a trade uses is closed and the other one is open, Trade
// offers "Buy from Ondo instead · open now" — this is the rule for when that button appears.
describe("otherOpenVenue", () => {
  it("offers the other issuer when the chosen one is closed and the other is open", () => {
    expect(otherOpenVenue("bstock", [{ platform: "bstock", buyable: false }, { platform: "ondo", buyable: true }])).toBe("ondo");
  });

  it("offers nothing while the chosen one is open", () => {
    expect(otherOpenVenue("bstock", [{ platform: "bstock", buyable: true }, { platform: "ondo", buyable: true }])).toBeUndefined();
  });

  it("offers nothing when neither is open, or there is no other issuer", () => {
    expect(otherOpenVenue("bstock", [{ platform: "bstock", buyable: false }, { platform: "ondo", buyable: false }])).toBeUndefined();
    expect(otherOpenVenue("bstock", [{ platform: "bstock", buyable: false }])).toBeUndefined();
    expect(otherOpenVenue(undefined, undefined)).toBeUndefined();
  });
});
