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
import { RULE_BOUNDS } from "@/lib/rules";

const bsc = getChain("bsc");

function objectResult(rule: Record<string, unknown>, explanation = "Vera will do this.") {
  return { object: { rule, explanation } };
}

beforeEach(() => {
  generateObjectSpy.mockReset();
});

describe("parseRuleGoal", () => {
  it("returns the model's rule, sanitized, and its explanation", async () => {
    generateObjectSpy.mockResolvedValue(objectResult({ type: "rebalance", driftPct: 12 }, "Vera will keep your basket near target."));

    const { rule, explanation } = await parseRuleGoal(bsc, "keep my basket balanced");

    expect(rule).toEqual({ type: "rebalance", driftPct: 12 });
    expect(explanation).toBe("Vera will keep your basket near target.");
    expect(generateObjectSpy).toHaveBeenCalledTimes(1);
  });

  it("passes the investable BSC universe into the prompt, so a made-up symbol can be checked", async () => {
    generateObjectSpy.mockResolvedValue(objectResult({ type: "buy_discount", symbol: "NVDA", discountPct: 3 }));

    await parseRuleGoal(bsc, "buy NVDA cheap");

    const { system } = generateObjectSpy.mock.calls[0][0] as { system: string };
    expect(system).toMatch(/NVDA/);
  });

  it("clamps an out-of-bounds number rather than passing it straight through", async () => {
    generateObjectSpy.mockResolvedValue(objectResult({ type: "safety_switch", dropPct: 5, movePct: 500 }));

    const { rule, explanation } = await parseRuleGoal(bsc, "move everything to safety on any dip");

    expect(rule).toEqual({ type: "safety_switch", dropPct: 5, movePct: RULE_BOUNDS.movePct.max });
    expect(explanation).toMatch(new RegExp(`${RULE_BOUNDS.movePct.max}%`));
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
});
