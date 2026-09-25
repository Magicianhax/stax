// planDryRunView pairs a Vera plan's per-leg Binance dry runs with each holding on PlanScreen.
// Failing-first: none of this exists yet.
import { describe, expect, it } from "vitest";
import { planDryRunView } from "./planDryRuns";
import type { DryRun } from "./dryRun";

const ALLOCATIONS = [{ symbol: "NVDA" }, { symbol: "AAPL" }];
const decimalsFor = () => 18;

describe("planDryRunView", () => {
  it("renders nothing and blocks nothing when there are no dry runs at all", () => {
    expect(planDryRunView(ALLOCATIONS, undefined, decimalsFor)).toEqual({ legs: [], blocked: false });
    expect(planDryRunView(ALLOCATIONS, [], decimalsFor)).toEqual({ legs: [], blocked: false });
  });

  it("reads a passed leg as a plain confirmation with the expected amount", () => {
    const dryRuns: DryRun[] = [
      { status: "passed", receiveRaw: (BigInt(2) * BigInt(10) ** BigInt(17)).toString(), checkedAt: 1 },
      { status: "skipped", reason: "no simulation", checkedAt: 1 },
    ];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs[0]).toEqual({ symbol: "NVDA", status: "checked", text: "Checked with Binance · you'll get about 0.2 NVDA" });
    expect(view.blocked).toBe(false);
  });

  it("never claims a check for a skipped leg — 'not checked yet', never 'checked'", () => {
    const dryRuns: DryRun[] = [
      { status: "skipped", reason: "first trade of this token", checkedAt: 1 },
      { status: "passed", receiveRaw: (BigInt(10) ** BigInt(18)).toString(), checkedAt: 1 },
    ];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs[0]).toEqual({ symbol: "NVDA", status: "not_checked", text: "Not checked yet — first trade of this token" });
  });

  it("treats a missing entry (dryRuns shorter than allocations) the same as skipped", () => {
    const dryRuns: DryRun[] = [{ status: "passed", receiveRaw: (BigInt(10) ** BigInt(18)).toString(), checkedAt: 1 }];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs[1].status).toBe("not_checked");
    expect(view.blocked).toBe(false);
  });

  it("surfaces a failed leg's reason and blocks the whole plan", () => {
    const dryRuns: DryRun[] = [
      { status: "passed", receiveRaw: (BigInt(10) ** BigInt(18)).toString(), checkedAt: 1 },
      { status: "failed", reason: "Binance rejected this trade", checkedAt: 1 },
    ];
    const view = planDryRunView(ALLOCATIONS, dryRuns, decimalsFor);
    expect(view.legs[1]).toEqual({ symbol: "AAPL", status: "failed", text: "Binance rejected this trade" });
    expect(view.blocked).toBe(true);
  });

  it("falls back to a safe reason when a failed leg carries none", () => {
    const dryRuns: DryRun[] = [{ status: "failed", checkedAt: 1 }];
    const view = planDryRunView([{ symbol: "NVDA" }], dryRuns, decimalsFor);
    expect(view.legs[0].text).toBe("Binance checked this trade and it wouldn't go through right now.");
  });
});
