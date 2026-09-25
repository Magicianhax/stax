import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_CHOICES,
  buyOnlyNote,
  cadenceForRule,
  clampRuleField,
  choiceTitle,
  stockChoices,
  whatVeraWillDo,
} from "./autopilotChoices";
import { getChain } from "./chains";

describe("AUTOPILOT_CHOICES", () => {
  it("leads with the schedule, and offers all six rules including earnings", () => {
    expect(AUTOPILOT_CHOICES.map((c) => c.type)).toEqual([
      "schedule_buy",
      "buy_discount",
      "earnings",
      "rebalance",
      "mix_keeper",
      "safety_switch",
    ]);
    expect(AUTOPILOT_CHOICES[0].title).toBe("Invest on a schedule");
  });

  it("describes earnings in the words the critique asked for", () => {
    const e = AUTOPILOT_CHOICES.find((c) => c.type === "earnings")!;
    expect(e.title).toBe("Buy before results");
    expect(e.sentence).toBe("Vera buys a stock a few days before the company reports results.");
  });

  it("keeps jargon out of every title and sentence", () => {
    for (const c of AUTOPILOT_CHOICES) {
      expect(`${c.title} ${c.sentence}`).not.toMatch(/rebalanc|drift|tier|gasless|authoriz/i);
    }
  });

  it("names a rule's saved plan after its card", () => {
    expect(choiceTitle("earnings")).toBe("Buy before results");
    expect(choiceTitle("buy_discount")).toBe("Buy the discount");
  });
});

describe("buyOnlyNote", () => {
  it("is shown for the rules that would otherwise sell", () => {
    for (const t of ["rebalance", "mix_keeper", "safety_switch"] as const) {
      expect(buyOnlyNote(t)).toBe("Vera only buys for now. She adds new money to what’s short instead of selling.");
    }
  });
  it("says the stock is kept after results for earnings", () => {
    expect(buyOnlyNote("earnings")).toMatch(/only buys for now/);
    expect(buyOnlyNote("earnings")).toMatch(/keeps the stock/);
  });
  it("is absent where nothing would be sold", () => {
    expect(buyOnlyNote("schedule_buy")).toBeNull();
    expect(buyOnlyNote("buy_discount")).toBeNull();
  });
});

describe("cadenceForRule", () => {
  it("checks earnings every day so the pre-results window is never skipped", () => {
    expect(cadenceForRule("earnings", "monthly")).toBe("daily");
  });
  it("keeps the picked cadence for every other rule", () => {
    expect(cadenceForRule("buy_discount", "weekly")).toBe("weekly");
    expect(cadenceForRule("schedule_buy", "monthly")).toBe("monthly");
  });
});

describe("clampRuleField", () => {
  it("clamps to the same bounds the server saves", () => {
    expect(clampRuleField("discountPct", 50)).toBe(15);
    expect(clampRuleField("buyDaysBefore", 0)).toBe(1);
    expect(clampRuleField("driftPct", Number.NaN)).toBe(10);
  });
});

describe("stockChoices", () => {
  const bsc = getChain("bsc");

  it("lists each BSC stock once, with its company name", () => {
    const list = stockChoices(bsc);
    const symbols = list.map((s) => s.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(list.find((s) => s.symbol === "NVDA")?.name).toBe("Nvidia");
  });

  it("never offers crypto or cash", () => {
    const symbols = stockChoices(bsc).map((s) => s.symbol);
    expect(symbols).not.toContain("USDT");
    expect(symbols).not.toContain("BTCB");
  });

  it("leaves funds out when asked, since funds don't report results", () => {
    expect(stockChoices(bsc).map((s) => s.symbol)).toContain("SPY");
    expect(stockChoices(bsc, { companiesOnly: true }).map((s) => s.symbol)).not.toContain("SPY");
  });
});

describe("whatVeraWillDo", () => {
  const base = { amountUsd: 25, cadence: "weekly" as const };

  it("uses the clamped numbers the server will save, not the raw input", () => {
    expect(whatVeraWillDo({ ...base, rule: { type: "buy_discount", symbol: "NVDA", discountPct: 50 } })).toBe(
      "Each week, if Nvidia is at least 15% cheaper than the real share, Vera buys $25 of it.",
    );
  });

  it("describes earnings as a buy only, checked daily", () => {
    expect(
      whatVeraWillDo({ ...base, rule: { type: "earnings", symbol: "NVDA", buyDaysBefore: 3, sellDaysAfter: 1 } }),
    ).toBe("Vera will buy $25 of Nvidia 3 days before it reports results.");
    expect(
      whatVeraWillDo({ ...base, rule: { type: "earnings", symbol: "NVDA", buyDaysBefore: 1, sellDaysAfter: 1 } }),
    ).toBe("Vera will buy $25 of Nvidia 1 day before it reports results.");
  });

  it("describes a schedule into a basket or toward a goal", () => {
    expect(whatVeraWillDo({ ...base, rule: { type: "schedule_buy" }, basketName: "Big Tech" })).toBe(
      "Vera will invest $25 every week in Big Tech.",
    );
    expect(whatVeraWillDo({ ...base, cadence: "biweekly", rule: { type: "schedule_buy" }, goal: "Grow my plan" })).toBe(
      "Vera will invest $25 every 2 weeks toward “Grow my plan”.",
    );
  });

  it("keeps the balance, mix and safety rules buy-only and jargon-free", () => {
    const balanced = whatVeraWillDo({ ...base, rule: { type: "rebalance", driftPct: 10 }, basketName: "Big Tech" });
    expect(balanced).toBe("Each week, Vera adds $25 to any stock in Big Tech that falls more than 10% below its share.");
    const mix = whatVeraWillDo({ ...base, cadence: "monthly", rule: { type: "mix_keeper", stockPct: 80 } });
    expect(mix).toBe("Each month, Vera adds $25 to stocks or crypto, whichever is short of 80% stocks and 20% crypto.");
    const safety = whatVeraWillDo({ ...base, cadence: "daily", rule: { type: "safety_switch", dropPct: 5, movePct: 50 } });
    expect(safety).toBe("Each day, if the market has dropped 5% or more in a day, Vera puts $25 into steadier funds.");
    for (const s of [balanced, mix, safety]) expect(s).not.toMatch(/sell|drift|rebalanc/i);
  });

  it("shows cents only when the amount has them", () => {
    expect(whatVeraWillDo({ amountUsd: 6.5, cadence: "weekly", rule: { type: "schedule_buy" } })).toBe(
      "Vera will invest $6.50 every week.",
    );
  });
});
