import { describe, expect, it } from "vitest";
import { historyStatus } from "./priceHistoryStatus";

describe("historyStatus", () => {
  it("is empty when nothing has ever been recorded", () => {
    expect(historyStatus(0)).toBe("empty");
  });
  it("is thin with only one snapshot — not enough to draw a line", () => {
    expect(historyStatus(1)).toBe("thin");
  });
  it("is chart with two or more snapshots", () => {
    expect(historyStatus(2)).toBe("chart");
    expect(historyStatus(50)).toBe("chart");
  });
});
