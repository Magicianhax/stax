// Vera turns a plain-language goal into one of the 5 pickable rule types, with sensible bounded
// defaults. The model (`ai`'s generateObject) is mocked throughout — nothing here makes a live
// Anthropic call — mirroring how allocate.bsc.test.ts mocks the same call.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateObjectSpy = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObjectSpy(...args) }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "mock-model" }));

import { parseRuleGoal, RuleRefusal } from "./rulesParser";
import { getChain } from "@/lib/chains";
import { RULE_BOUNDS, RULE_COMING_SOON_REASON } from "@/lib/rules";

const bsc = getChain("bsc");

function objectResult(rule: Record<string, unknown>, explanation = "Vera will do this.") {
  return { object: { rule, explanation } };
}

beforeEach(() => {
  generateObjectSpy.mockReset();
});

describe("parseRuleGoal", () => {
  it("returns the model's rule, sanitized, and its explanation", async () => {
    generateObjectSpy.mockResolvedValue(objectResult({ type: "buy_discount", symbol: "NVDA", discountPct: 4 }, "Vera will buy NVDA when it's cheap."));

    const { rule, explanation } = await parseRuleGoal(bsc, "buy NVDA when it's cheap");

    expect(rule).toEqual({ type: "buy_discount", symbol: "NVDA", discountPct: 4 });
    expect(explanation).toBe("Vera will buy NVDA when it's cheap.");
    expect(generateObjectSpy).toHaveBeenCalledTimes(1);
  });

  it("passes the investable BSC universe into the prompt, so a made-up symbol can be checked", async () => {
    generateObjectSpy.mockResolvedValue(objectResult({ type: "buy_discount", symbol: "NVDA", discountPct: 3 }));

    await parseRuleGoal(bsc, "buy NVDA cheap");

    const { system } = generateObjectSpy.mock.calls[0][0] as { system: string };
    expect(system).toMatch(/NVDA/);
  });

  it("clamps an out-of-bounds number rather than passing it straight through", async () => {
    generateObjectSpy.mockResolvedValue(objectResult({ type: "buy_discount", symbol: "NVDA", discountPct: 90 }));

    const { rule, explanation } = await parseRuleGoal(bsc, "buy NVDA the instant it's even slightly cheap");

    expect(rule).toEqual({ type: "buy_discount", symbol: "NVDA", discountPct: RULE_BOUNDS.discountPct.max });
    expect(explanation).toMatch(new RegExp(`${RULE_BOUNDS.discountPct.max}%`));
  });

  it("refuses a buy_discount rule for a symbol that isn't tradeable on this chain", async () => {
    generateObjectSpy.mockResolvedValue(objectResult({ type: "buy_discount", symbol: "ZZZZ", discountPct: 3 }));

    await expect(parseRuleGoal(bsc, "buy ZZZZ cheap")).rejects.toBeInstanceOf(RuleRefusal);
    await expect(parseRuleGoal(bsc, "buy ZZZZ cheap")).rejects.toThrow(/ZZZZ/);
  });

  it("refuses an earnings rule for a symbol that isn't tradeable on this chain", async () => {
    generateObjectSpy.mockResolvedValue(objectResult({ type: "earnings", symbol: "ZZZZ", buyDaysBefore: 3, sellDaysAfter: 1 }));

    await expect(parseRuleGoal(bsc, "buy ZZZZ before earnings")).rejects.toBeInstanceOf(RuleRefusal);
  });

  it.each(["rebalance", "safety_switch", "mix_keeper"] as const)(
    "refuses a %s rule as coming soon — it can't act without a live holdings read yet",
    async (type) => {
      const ruleByType: Record<string, Record<string, unknown>> = {
        rebalance: { type: "rebalance", driftPct: 10 },
        safety_switch: { type: "safety_switch", dropPct: 5, movePct: 50 },
        mix_keeper: { type: "mix_keeper", stockPct: 80 },
      };
      generateObjectSpy.mockResolvedValue(objectResult(ruleByType[type]));

      const promise = parseRuleGoal(bsc, "anything");
      await expect(promise).rejects.toBeInstanceOf(RuleRefusal);
      await expect(promise).rejects.toThrow(RULE_COMING_SOON_REASON);
    },
  );
});
