import { describe, expect, it } from "vitest";
import { chosenVenueFor } from "./assetVenuePicker";

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
