// Pure rule types + evaluators Vera runs for the user on BSC via Autopilot. No network, no
// chain client — every input is a plain value the caller (rulesEngine.ts, or a test) supplies.
import { describe, expect, it } from "vitest";
import {
  RULE_BOUNDS,
  RULE_CARDS,
  RULE_DEFAULTS,
  sanitizeRule,
  isValidRule,
  encodeRuleGoal,
  decodeRuleGoal,
  evaluateRebalance,
  evaluateBuyDiscount,
  evaluateSafetySwitch,
  evaluateMixKeeper,
  evaluateEarnings,
  formatRuleReceipt,
  describeRule,
  RULES_NEEDING_HOLDINGS,
  HOLDINGS_RULE_TYPES,
  type Rule,
  type RuleIntent,
} from "./rules";

describe("RULE_CARDS", () => {
  it("has exactly the 5 pickable rules (earnings is evaluator-only, no card)", () => {
    expect(RULE_CARDS.map((c) => c.type).sort()).toEqual(
      ["buy_discount", "mix_keeper", "rebalance", "safety_switch", "schedule_buy"].sort(),
    );
  });

  it("gives every card a one-sentence description and an example", () => {
    for (const card of RULE_CARDS) {
      expect(card.sentence.length).toBeGreaterThan(0);
      expect(card.sentence.split(".").filter(Boolean).length).toBeLessThanOrEqual(2);
      expect(card.example.length).toBeGreaterThan(0);
    }
  });
});

describe("sanitizeRule — bounded defaults, never trusts a raw number", () => {
  it("clamps a rebalance drift below the floor up to the minimum", () => {
    const r = sanitizeRule({ type: "rebalance", driftPct: 0 });
    expect(r).toEqual({ type: "rebalance", driftPct: RULE_BOUNDS.driftPct.min });
  });

  it("clamps a rebalance drift above the ceiling down to the maximum", () => {
    const r = sanitizeRule({ type: "rebalance", driftPct: 999 });
    expect(r).toEqual({ type: "rebalance", driftPct: RULE_BOUNDS.driftPct.max });
  });

  it("fills in the default when a number is missing or not finite", () => {
    const r = sanitizeRule({ type: "safety_switch", dropPct: NaN, movePct: undefined as unknown as number });
    expect(r).toEqual({ type: "safety_switch", dropPct: RULE_DEFAULTS.safety_switch.dropPct, movePct: RULE_DEFAULTS.safety_switch.movePct });
  });

  it("leaves an in-bounds value alone", () => {
    const r = sanitizeRule({ type: "mix_keeper", stockPct: 70 });
    expect(r).toEqual({ type: "mix_keeper", stockPct: 70 });
  });

  it("passes schedule_buy through unchanged (today's Autopilot DCA, no new params)", () => {
    expect(sanitizeRule({ type: "schedule_buy" })).toEqual({ type: "schedule_buy" });
  });
});

describe("isValidRule", () => {
  it("accepts a well-formed rule", () => {
    expect(isValidRule({ type: "rebalance", driftPct: 10 })).toBe(true);
  });

  it("rejects an unknown type", () => {
    expect(isValidRule({ type: "moon_shot" })).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isValidRule(null)).toBe(false);
    expect(isValidRule("rebalance")).toBe(false);
    expect(isValidRule({ type: "buy_discount" })).toBe(false); // missing symbol
  });
});

describe("encodeRuleGoal / decodeRuleGoal — the goal-column round trip", () => {
  it("round-trips a rule and its display goal", () => {
    const rule: Rule = { type: "rebalance", driftPct: 12 };
    const encoded = encodeRuleGoal(rule, "Keep my AI chips basket balanced");
    const decoded = decodeRuleGoal(encoded);
    expect(decoded).toEqual({ rule, displayGoal: "Keep my AI chips basket balanced" });
  });

  it("returns null for a plain goal string (no rule encoded)", () => {
    expect(decodeRuleGoal("Grow my long-term plan")).toBeNull();
  });

  it("returns null and never throws on a corrupted encoding", () => {
    expect(decodeRuleGoal("stax:rule:v1:{not json}::hi")).toBeNull();
  });

  it("sanitizes on decode, so a tampered out-of-bounds value can't reach the executor", () => {
    const tampered = `stax:rule:v1:${JSON.stringify({ type: "safety_switch", dropPct: 999, movePct: 5 })}::x`;
    const decoded = decodeRuleGoal(tampered);
    expect(decoded?.rule).toEqual({ type: "safety_switch", dropPct: RULE_BOUNDS.dropPct.max, movePct: RULE_BOUNDS.movePct.min });
  });
});

describe("evaluateRebalance", () => {
  it("does nothing when every holding is within the drift threshold", () => {
    const intents = evaluateRebalance(
      [{ symbol: "NVDA", usdValue: 61 }, { symbol: "AMD", usdValue: 39 }],
      [{ symbol: "NVDA", weightPct: 60 }, { symbol: "AMD", weightPct: 40 }],
      10,
      1000,
    );
    expect(intents).toEqual([]);
  });

  it("sells the overweight name and buys the underweight one past the threshold", () => {
    // 100 total, NVDA at 75% (target 60, drift 15 > 10), AMD at 25% (target 40, drift -15).
    const intents = evaluateRebalance(
      [{ symbol: "NVDA", usdValue: 75 }, { symbol: "AMD", usdValue: 25 }],
      [{ symbol: "NVDA", weightPct: 60 }, { symbol: "AMD", weightPct: 40 }],
      10,
      1000,
    );
    expect(intents).toEqual([
      { symbol: "NVDA", action: "sell", usd: 15, reason: expect.stringContaining("NVDA") },
      { symbol: "AMD", action: "buy", usd: 15, reason: expect.stringContaining("AMD") },
    ]);
  });

  it("sells a holding entirely out of target when it isn't in the target list at all", () => {
    const intents = evaluateRebalance(
      [{ symbol: "TSLA", usdValue: 100 }],
      [{ symbol: "NVDA", weightPct: 100 }],
      10,
      1000,
    );
    expect(intents.find((i) => i.symbol === "TSLA")).toMatchObject({ action: "sell", usd: 100 });
    expect(intents.find((i) => i.symbol === "NVDA")).toMatchObject({ action: "buy", usd: 100 });
  });

  it("caps the total moved at the budget, scaling every leg down together", () => {
    const intents = evaluateRebalance(
      [{ symbol: "NVDA", usdValue: 90 }, { symbol: "AMD", usdValue: 10 }],
      [{ symbol: "NVDA", weightPct: 50 }, { symbol: "AMD", weightPct: 50 }],
      10,
      20, // only $20 may move this run, even though drift implies $40
    );
    const sell = intents.find((i) => i.symbol === "NVDA")!;
    const buy = intents.find((i) => i.symbol === "AMD")!;
    expect(sell.usd).toBeCloseTo(20, 5);
    expect(buy.usd).toBeCloseTo(20, 5);
  });

  it("does nothing with no holdings to rebalance from", () => {
    expect(evaluateRebalance([], [{ symbol: "NVDA", weightPct: 100 }], 10, 100)).toEqual([]);
  });
});

describe("evaluateBuyDiscount", () => {
  it("buys when the token is buyable and cheaper than the real share by at least the threshold", () => {
    const intents = evaluateBuyDiscount({ symbol: "NVDA", buyable: true, gapPct: -3 }, 2, 25);
    expect(intents).toEqual([{ symbol: "NVDA", action: "buy", usd: 25, reason: expect.stringContaining("3") }]);
  });

  it("does nothing when the discount is smaller than the threshold", () => {
    expect(evaluateBuyDiscount({ symbol: "NVDA", buyable: true, gapPct: -1 }, 2, 25)).toEqual([]);
  });

  it("does nothing when it isn't buyable right now, even if the price looks cheap", () => {
    expect(evaluateBuyDiscount({ symbol: "NVDA", buyable: false, gapPct: -5 }, 2, 25)).toEqual([]);
  });

  it("does nothing when the token is trading above the real share", () => {
    expect(evaluateBuyDiscount({ symbol: "NVDA", buyable: true, gapPct: 3 }, 2, 25)).toEqual([]);
  });

  it("does nothing with no usable gap", () => {
    expect(evaluateBuyDiscount({ symbol: "NVDA", buyable: true, gapPct: null }, 2, 25)).toEqual([]);
  });

  it("carries the venue's platform onto the intent, so the executor knows which issuer it priced", () => {
    const intents = evaluateBuyDiscount({ symbol: "NVDA", buyable: true, gapPct: -3, platform: "ondo" }, 2, 25);
    expect(intents).toEqual([expect.objectContaining({ platform: "ondo" })]);
  });
});

describe("RULES_NEEDING_HOLDINGS", () => {
  it("is empty now that rebalance, safety_switch and mix_keeper can all act (buy-only) on a real holdings read", () => {
    expect(RULES_NEEDING_HOLDINGS).toEqual([]);
  });
});

describe("HOLDINGS_RULE_TYPES", () => {
  it("lists exactly the three rules whose plan depends on ctx.holdings", () => {
    expect(HOLDINGS_RULE_TYPES).toEqual(["rebalance", "safety_switch", "mix_keeper"]);
  });

  it("excludes the two rules that never look at holdings (schedule_buy, buy_discount)", () => {
    expect(HOLDINGS_RULE_TYPES).not.toContain("schedule_buy");
    expect(HOLDINGS_RULE_TYPES).not.toContain("buy_discount");
  });
});

describe("evaluateSafetySwitch", () => {
  it("does nothing when the market hasn't dropped enough", () => {
    const intents = evaluateSafetySwitch(
      [{ symbol: "NVDA", usdValue: 100 }],
      3, // dropped 3%
      5, // threshold 5%
      50,
      ["SPY"],
      1000,
    );
    expect(intents).toEqual([]);
  });

  it("sells a share of every risky holding and buys evenly into the safer list once the drop clears the threshold", () => {
    const intents = evaluateSafetySwitch(
      [{ symbol: "NVDA", usdValue: 60 }, { symbol: "TSLA", usdValue: 40 }],
      8, // dropped 8%
      5,
      50, // move 50% of the risky pool
      ["SPY", "QQQ"],
      1000,
    );
    const sells = intents.filter((i) => i.action === "sell");
    const buys = intents.filter((i) => i.action === "buy");
    expect(sells).toEqual([
      { symbol: "NVDA", action: "sell", usd: 30, reason: expect.any(String) },
      { symbol: "TSLA", action: "sell", usd: 20, reason: expect.any(String) },
    ]);
    expect(buys).toEqual([
      { symbol: "SPY", action: "buy", usd: 25, reason: expect.any(String) },
      { symbol: "QQQ", action: "buy", usd: 25, reason: expect.any(String) },
    ]);
  });

  it("never sells a holding that is itself on the safer list", () => {
    const intents = evaluateSafetySwitch(
      [{ symbol: "NVDA", usdValue: 50 }, { symbol: "SPY", usdValue: 50 }],
      10,
      5,
      100,
      ["SPY"],
      1000,
    );
    expect(intents.some((i) => i.symbol === "SPY" && i.action === "sell")).toBe(false);
  });

  it("does nothing when there is nowhere safer to move the money", () => {
    const intents = evaluateSafetySwitch([{ symbol: "NVDA", usdValue: 100 }], 10, 5, 50, [], 1000);
    expect(intents).toEqual([]);
  });

  it("caps the amount moved at the per-run budget", () => {
    const intents = evaluateSafetySwitch(
      [{ symbol: "NVDA", usdValue: 100 }],
      10,
      5,
      100, // wants to move all of it
      ["SPY"],
      20, // budget only allows $20
    );
    expect(intents.find((i) => i.symbol === "NVDA")!.usd).toBeCloseTo(20, 5);
    expect(intents.find((i) => i.symbol === "SPY")!.usd).toBeCloseTo(20, 5);
  });
});

describe("evaluateMixKeeper", () => {
  it("does nothing within tolerance of the target stock/crypto split", () => {
    const intents = evaluateMixKeeper(
      [{ symbol: "NVDA", tier: "stock", usdValue: 78 }, { symbol: "BTCB", tier: "crypto", usdValue: 22 }],
      80,
      5,
      1000,
    );
    expect(intents).toEqual([]);
  });

  it("sells crypto and buys stock when crypto has grown past the target + tolerance", () => {
    // 100 total: stock 60%, crypto 40%; target 80/20, tolerance 5 -> drift 20 > 5.
    const intents = evaluateMixKeeper(
      [{ symbol: "NVDA", tier: "stock", usdValue: 60 }, { symbol: "BTCB", tier: "crypto", usdValue: 40 }],
      80,
      5,
      1000,
    );
    expect(intents).toEqual([
      { symbol: "BTCB", action: "sell", usd: 20, reason: expect.any(String) },
      { symbol: "NVDA", action: "buy", usd: 20, reason: expect.any(String) },
    ]);
  });

  it("sells stock and buys crypto when stock has grown past the target + tolerance", () => {
    const intents = evaluateMixKeeper(
      [{ symbol: "NVDA", tier: "stock", usdValue: 95 }, { symbol: "BTCB", tier: "crypto", usdValue: 5 }],
      80,
      5,
      1000,
    );
    expect(intents).toEqual([
      { symbol: "NVDA", action: "sell", usd: 15, reason: expect.any(String) },
      { symbol: "BTCB", action: "buy", usd: 15, reason: expect.any(String) },
    ]);
  });

  it("falls back to a default asset on the underweight side when nothing is held there yet", () => {
    const intents = evaluateMixKeeper([{ symbol: "NVDA", tier: "stock", usdValue: 100 }], 80, 5, 1000);
    const buy = intents.find((i) => i.action === "buy")!;
    expect(buy.symbol).toBe("BTCB"); // the chain's default crypto fallback
  });

  it("ignores safe-tier holdings entirely — only stock vs crypto count toward the mix", () => {
    const intents = evaluateMixKeeper(
      [
        { symbol: "NVDA", tier: "stock", usdValue: 60 },
        { symbol: "BTCB", tier: "crypto", usdValue: 40 },
        { symbol: "USDY", tier: "safe", usdValue: 500 },
      ],
      80,
      5,
      1000,
    );
    expect(intents.every((i) => i.symbol !== "USDY")).toBe(true);
  });
});

describe("evaluateEarnings", () => {
  const DAY = 86_400_000;
  const earnings = Date.parse("2026-11-05T00:00:00.000Z");

  it("says hold well before the window opens", () => {
    expect(evaluateEarnings(earnings - 10 * DAY, earnings, 3, 1)).toBe("hold");
  });

  it("says buy once inside the pre-earnings window", () => {
    expect(evaluateEarnings(earnings - 2 * DAY, earnings, 3, 1)).toBe("buy");
  });

  it("says sell on and right after earnings, within the sell window", () => {
    expect(evaluateEarnings(earnings, earnings, 3, 1)).toBe("sell");
    expect(evaluateEarnings(earnings + DAY, earnings, 3, 1)).toBe("sell");
  });

  it("says hold once the sell window has passed", () => {
    expect(evaluateEarnings(earnings + 2 * DAY, earnings, 3, 1)).toBe("hold");
  });
});

describe("describeRule — the live 'What Vera will do' preview while setting a rule up", () => {
  it("describes schedule_buy", () => {
    expect(describeRule({ type: "schedule_buy" })).toBe("Vera will invest for you automatically, on your schedule.");
  });

  it("describes rebalance with the actual drift number", () => {
    expect(describeRule({ type: "rebalance", driftPct: 12 })).toBe(
      "Vera will keep your basket close to target, fixing anything that drifts more than 12%.",
    );
  });

  it("describes buy_discount with the actual symbol and discount", () => {
    expect(describeRule({ type: "buy_discount", symbol: "NVDA", discountPct: 3 })).toBe(
      "Vera will buy NVDA when it's at least 3% cheaper than the real share.",
    );
  });

  it("describes safety_switch with the actual drop and move numbers", () => {
    expect(describeRule({ type: "safety_switch", dropPct: 5, movePct: 50 })).toBe(
      "If the market drops 5% in a day, Vera will move 50% of your at-risk holdings into steadier ones.",
    );
  });

  it("describes mix_keeper with the actual split", () => {
    expect(describeRule({ type: "mix_keeper", stockPct: 80 })).toBe(
      "Vera will keep about 80% of your money in stocks and 20% in crypto.",
    );
  });

  it("describes earnings with the actual symbol and windows", () => {
    expect(describeRule({ type: "earnings", symbol: "AAPL", buyDaysBefore: 3, sellDaysAfter: 1 })).toBe(
      "Vera will buy AAPL 3 days before its earnings and sell it 1 day after.",
    );
  });
});

describe("formatRuleReceipt", () => {
  it("names the basket and every leg for a rebalance", () => {
    const intents: RuleIntent[] = [
      { symbol: "NVDA", action: "sell", usd: 12, reason: "x" },
      { symbol: "AMD", action: "buy", usd: 12, reason: "x" },
    ];
    expect(formatRuleReceipt({ type: "rebalance", driftPct: 10 }, intents, "AI chips basket")).toBe(
      "Vera rebalanced your AI chips basket: sold $12 of NVDA, bought $12 of AMD.",
    );
  });

  it("reads as a plain discount buy with no basket name", () => {
    const intents: RuleIntent[] = [{ symbol: "NVDA", action: "buy", usd: 25, reason: "x" }];
    expect(formatRuleReceipt({ type: "buy_discount", symbol: "NVDA", discountPct: 2 }, intents)).toBe(
      "Vera bought the discount: bought $25 of NVDA.",
    );
  });

  it("reads as moving into steadier holdings for a safety switch", () => {
    const intents: RuleIntent[] = [
      { symbol: "NVDA", action: "sell", usd: 30, reason: "x" },
      { symbol: "SPY", action: "buy", usd: 30, reason: "x" },
    ];
    expect(formatRuleReceipt({ type: "safety_switch", dropPct: 5, movePct: 50 }, intents)).toBe(
      "Vera moved you into steadier holdings: sold $30 of NVDA, bought $30 of SPY.",
    );
  });

  it("reads as keeping the stocks/crypto mix", () => {
    const intents: RuleIntent[] = [
      { symbol: "BTCB", action: "sell", usd: 20, reason: "x" },
      { symbol: "NVDA", action: "buy", usd: 20, reason: "x" },
    ];
    expect(formatRuleReceipt({ type: "mix_keeper", stockPct: 80 }, intents)).toBe(
      "Vera kept your mix on target: sold $20 of BTCB, bought $20 of NVDA.",
    );
  });

  it("returns an empty-run line when nothing needed to move", () => {
    expect(formatRuleReceipt({ type: "rebalance", driftPct: 10 }, [], "AI chips basket")).toBe(
      "Vera checked your AI chips basket: already on target, nothing to do.",
    );
  });
});
