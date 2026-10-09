import { describe, expect, it } from "vitest";
import { boughtHoldings, skippedLine } from "./investSummary";
import type { Allocation } from "./allocation-schema";

const alloc: Allocation = {
  summary: "s",
  rationale: "r",
  riskScore: 6000,
  allocations: [
    { symbol: "NVDA", weightPct: 35, reason: "a" },
    { symbol: "AVGO", weightPct: 30, reason: "b" },
    { symbol: "TSM", weightPct: 20, reason: "c" },
    { symbol: "QCOM", weightPct: 15, reason: "d" },
  ],
};

describe("boughtHoldings", () => {
  it("is the plan as reviewed when nothing was left out", () => {
    const h = boughtHoldings(alloc, 50);
    expect(h.map((x) => x.symbol)).toEqual(["NVDA", "AVGO", "TSM", "QCOM"]);
    expect(h[0]).toMatchObject({ weightPct: 35, amountUsd: 17.5 });
  });

  it("never lists a skipped holding as bought, and gives its share to the rest", () => {
    const h = boughtHoldings(alloc, 50, ["QCOM"]);
    expect(h.map((x) => x.symbol)).toEqual(["NVDA", "AVGO", "TSM"]);
    expect(h.reduce((s, x) => s + x.amountUsd, 0)).toBeCloseTo(50, 6);
    expect(h[0].weightPct).toBeCloseTo(41.2, 1);
  });
});

describe("skippedLine", () => {
  const names: Record<string, string> = { QCOM: "Qualcomm", PLTR: "Palantir" };
  const nameOf = (s: string) => names[s] ?? s;
  it("names one holding by its company name", () => {
    expect(skippedLine(["QCOM"], nameOf)).toBe("Qualcomm had no seller on Binance just now, so its share went to the others.");
  });

  it("joins several with 'and' and says 'their'", () => {
    expect(skippedLine(["QCOM", "PLTR"], nameOf)).toBe("Qualcomm and Palantir had no seller on Binance just now, so their share went to the others.");
  });
});
