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

  it("is loading while the query hasn't resolved yet, even with zero points so far", () => {
    // Regression: on first paint `chosenHistoryPoints` is `[]` before the fetch resolves, which
    // used to read identically to a resolved-and-empty history.
    expect(historyStatus(0, { isLoading: true, isError: false })).toBe("loading");
  });

  it("is error when the fetch failed, not empty", () => {
    // Regression: a failed fetch left `chosenHistoryPoints` at `[]` forever, which used to show
    // the "we start recording..." sentence permanently instead of nothing.
    expect(historyStatus(0, { isLoading: false, isError: true })).toBe("error");
  });

  it("loading takes precedence over error", () => {
    expect(historyStatus(0, { isLoading: true, isError: true })).toBe("loading");
  });

  it("is empty only once the query has actually resolved with nothing", () => {
    expect(historyStatus(0, { isLoading: false, isError: false })).toBe("empty");
  });
});
