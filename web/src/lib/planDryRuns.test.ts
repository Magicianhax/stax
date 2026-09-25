// planDryRunView pairs a Vera plan's per-leg Binance dry runs with each holding on PlanScreen,
// by the leg's own symbol (or its token address), never by position: a nudge or a retried plan
// can reorder or resize the legs, and a positional match then pinned one stock's failure on
// another (design critique P0 #1).
import { describe, expect, it } from "vitest";
import { planCheckFailedMessage, planDryRunView } from "./planDryRuns";
import type { DryRun } from "./dryRun";

const NVDA_ADDR = "0x1111111111111111111111111111111111111111" as const;
const AAPL_ADDR = "0x2222222222222222222222222222222222222222" as const;
const ALLOCATIONS = [
  { symbol: "NVDA", address: NVDA_ADDR },
  { symbol: "AAPL", address: AAPL_ADDR },
];
const decimalsFor = () => 18;
const ONE = (BigInt(10) ** BigInt(18)).toString();

describe("planDryRunView", () => {
  it("renders nothing and blocks nothing when there are no dry runs at all", () => {
    expect(planDryRunView(ALLOCATIONS, undefined, decimalsFor)).toEqual({ legs: [], blocked: false, failedSymbols: [] });
    expect(planDryRunView(ALLOCATIONS, [], decimalsFor)).toEqual({ legs: [], blocked: false, failedSymbols: [] });
  });

  it("reads a passed leg as a plain confirmation with the expected amount", () => {
    const dryRuns: DryRun[] = [
      { symbol: "NVDA", status: "passed", receiveRaw: (BigInt(2) * BigInt(10) ** BigInt(17)).toString(), checkedAt: 1 },
      { symbol: "AAPL", status: "skipped", reason: "no simulation", checkedAt: 1 },
    ];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs[0]).toEqual({ symbol: "NVDA", status: "checked", text: "Checked with Binance · you'll get about 0.2 NVDA" });
    expect(view.blocked).toBe(false);
  });

  it("says a skipped leg is checked at invest time, never that it was checked", () => {
    const dryRuns: DryRun[] = [{ symbol: "NVDA", status: "skipped", reason: "first trade of this token", checkedAt: 1 }];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs[0]).toEqual({ symbol: "NVDA", status: "not_checked", text: "Binance checks this when you invest" });
  });

  it("matches by symbol, not by position, when the dry runs come back in a different order", () => {
    const dryRuns: DryRun[] = [
      { symbol: "AAPL", status: "failed", reason: "execution reverted", checkedAt: 1 },
      { symbol: "NVDA", status: "passed", receiveRaw: ONE, checkedAt: 1 },
    ];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs.find((l) => l.symbol === "NVDA")?.status).toBe("checked");
    expect(view.legs.find((l) => l.symbol === "AAPL")?.status).toBe("failed");
    expect(view.failedSymbols).toEqual(["AAPL"]);
  });

  it("falls back to the token address when a dry run carries no symbol", () => {
    const dryRuns: DryRun[] = [{ token: AAPL_ADDR.toUpperCase().replace("0X", "0x") as `0x${string}`, status: "failed", checkedAt: 1 }];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs.find((l) => l.symbol === "AAPL")?.status).toBe("failed");
    expect(view.legs.find((l) => l.symbol === "NVDA")?.status).toBe("not_checked");
  });

  it("never pins a dry run on a leg by position alone", () => {
    // A stale dry run for a stock no longer in the plan must not land on whatever sits in its slot.
    const dryRuns: DryRun[] = [{ symbol: "TSLA", status: "failed", checkedAt: 1 }];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.blocked).toBe(false);
    expect(view.legs.every((l) => l.status === "not_checked")).toBe(true);
  });

  it("reads a failed leg in plain words, never Binance's raw reason", () => {
    const dryRuns: DryRun[] = [{ symbol: "AAPL", status: "failed", reason: "This trade needs one more approval step first.", checkedAt: 1 }];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs.find((l) => l.symbol === "AAPL")).toEqual({
      symbol: "AAPL",
      status: "failed",
      text: "Binance couldn't confirm this part just now",
    });
    expect(view.blocked).toBe(true);
  });
});

describe("planCheckFailedMessage", () => {
  it("names the stock and offers both ways forward on a Vera plan", () => {
    expect(planCheckFailedMessage(["Apple"], true)).toBe(
      "Binance couldn't confirm the Apple part just now. Hold to try again, or tap Make it safer.",
    );
  });

  it("names two stocks as one sentence", () => {
    expect(planCheckFailedMessage(["Apple", "Nvidia"], true)).toBe(
      "Binance couldn't confirm the Apple and Nvidia parts just now. Hold to try again, or tap Make it safer.",
    );
  });

  it("drops the nudge when the plan is a fixed basket with no Make it safer chip", () => {
    expect(planCheckFailedMessage(["Apple"], false)).toBe("Binance couldn't confirm the Apple part just now. Hold to try again.");
  });

  it("has nothing to say when nothing failed", () => {
    expect(planCheckFailedMessage([], true)).toBe("");
  });
});
