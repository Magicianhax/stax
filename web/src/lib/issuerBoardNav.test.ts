import { describe, expect, it } from "vitest";
import { boardRowTargetVenue } from "./issuerBoardNav";

describe("boardRowTargetVenue", () => {
  it("prefers the buyable-aware cheaperIssuer over the board row's plain cheaper", () => {
    // Regression: the board said "Ondo is cheaper" (plain price), but Ondo was paused, so the
    // buyable-aware call landed on bStock — the tap must follow the buyable one, not the plain one.
    const board = [{ ticker: "AAPL", cheaper: "ondo" as const }];
    const tickers = [{ ticker: "AAPL", cheaperIssuer: "bstock" as const }];
    expect(boardRowTargetVenue("AAPL", board, tickers)).toBe("bstock");
  });

  it("falls back to the board row's cheaper when the ticker call is missing", () => {
    const board = [{ ticker: "AAPL", cheaper: "ondo" as const }];
    expect(boardRowTargetVenue("AAPL", board, [])).toBe("ondo");
  });

  it("falls back to the board row when the ticker call has no cheaperIssuer", () => {
    const board = [{ ticker: "AAPL", cheaper: "ondo" as const }];
    const tickers = [{ ticker: "AAPL", cheaperIssuer: null }];
    expect(boardRowTargetVenue("AAPL", board, tickers)).toBe("ondo");
  });

  it("is undefined when the ticker is in neither list", () => {
    expect(boardRowTargetVenue("MSFT", [], [])).toBeUndefined();
  });
});
