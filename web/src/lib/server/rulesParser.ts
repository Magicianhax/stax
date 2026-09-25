import "server-only";

// Vera turns a plain-language goal into one of Autopilot's rule types (lib/rules.ts), with
// sensible bounded defaults — the "small parser/LLM step" item B of the rules stream asks for.
// Mirrors lib/server/allocate.ts: `generateObject` forced onto a zod schema, mocked in tests the
// same way (see rulesParser.test.ts), so this file never makes a live Anthropic call in CI.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { investableAssets } from "@/lib/chains";
import type { StaxChain } from "@/lib/chains/types";
import { RULE_BOUNDS, RULE_CARDS, RULES_NEEDING_HOLDINGS, RULE_COMING_SOON_REASON, sanitizeRule, type Rule } from "@/lib/rules";

const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

const RuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule_buy") }),
  z.object({ type: z.literal("rebalance"), driftPct: z.number() }),
  z.object({ type: z.literal("buy_discount"), symbol: z.string(), discountPct: z.number() }),
  z.object({ type: z.literal("safety_switch"), dropPct: z.number(), movePct: z.number() }),
  z.object({ type: z.literal("mix_keeper"), stockPct: z.number() }),
  // earnings: the date (`nextEarningsMs`) comes from a data source another stream builds
  // (wiringNeeded); Vera can still record what the user wants done AROUND that date.
  z.object({ type: z.literal("earnings"), symbol: z.string(), buyDaysBefore: z.number(), sellDaysAfter: z.number() }),
]);

const ParsedRuleSchema = z.object({
  rule: RuleSchema,
  explanation: z.string().describe("One or two short, plain sentences telling the user exactly what Vera will do. No jargon."),
});

/** A goal Vera can't honor as asked (a symbol that isn't tradeable here) — mapped to a 4xx by the caller, same pattern as AllocationRefusal. */
export class RuleRefusal extends Error {}

function systemPrompt(universe: string[]): string {
  const cardLines = RULE_CARDS.map((c) => `- ${c.type}: ${c.sentence} Example: "${c.example}"`).join("\n");
  return [
    "You are Stax, an AI investing copilot. A user just described, in plain language, a rule they",
    "want their automatic investing (Autopilot) to follow. Turn it into exactly ONE of these rule",
    "types, with numbers that match what they asked for:",
    "",
    cardLines,
    "- earnings: buy a stock some days before its next earnings report and sell some days after.",
    "",
    `Tradeable symbols on this chain right now: ${universe.join(", ")}. A buy_discount or earnings`,
    "rule's symbol MUST be one of these.",
    "",
    "Bounds (a number outside these will be capped automatically, so pick the closest sensible",
    "value rather than an extreme one):",
    `- rebalance driftPct: ${RULE_BOUNDS.driftPct.min}-${RULE_BOUNDS.driftPct.max} (default ${RULE_BOUNDS.driftPct.default})`,
    `- buy_discount discountPct: ${RULE_BOUNDS.discountPct.min}-${RULE_BOUNDS.discountPct.max} (default ${RULE_BOUNDS.discountPct.default})`,
    `- safety_switch dropPct: ${RULE_BOUNDS.dropPct.min}-${RULE_BOUNDS.dropPct.max} (default ${RULE_BOUNDS.dropPct.default}), movePct: ${RULE_BOUNDS.movePct.min}-${RULE_BOUNDS.movePct.max} (default ${RULE_BOUNDS.movePct.default})`,
    `- mix_keeper stockPct: ${RULE_BOUNDS.stockPct.min}-${RULE_BOUNDS.stockPct.max} (default ${RULE_BOUNDS.stockPct.default})`,
    `- earnings buyDaysBefore / sellDaysAfter: ${RULE_BOUNDS.buyDaysBefore.min}-${RULE_BOUNDS.buyDaysBefore.max} days`,
    "",
    "Writing style for `explanation`: one or two short plain sentences, no jargon, no em dashes.",
    "Say plainly what Vera will do, using the actual numbers you picked.",
  ].join("\n");
}

/** Which universe symbol(s) a rule names, so a made-up ticker can be refused before it's saved. */
function symbolsIn(rule: Rule): string[] {
  if (rule.type === "buy_discount" || rule.type === "earnings") return [rule.symbol];
  return [];
}

/** A one-sentence note appended to the explanation when sanitizing changed a number the model picked. */
function clampNote(before: Rule, after: Rule): string | null {
  const notes: string[] = [];
  const compare = (label: string, a: number, b: number, unit = "%") => {
    if (a !== b) notes.push(`Vera capped ${label} at ${b}${unit} (the safe limit).`);
  };
  if (before.type === "rebalance" && after.type === "rebalance") compare("the drift threshold", before.driftPct, after.driftPct);
  if (before.type === "buy_discount" && after.type === "buy_discount") compare("the discount", before.discountPct, after.discountPct);
  if (before.type === "safety_switch" && after.type === "safety_switch") {
    compare("the drop threshold", before.dropPct, after.dropPct);
    compare("the amount moved", before.movePct, after.movePct);
  }
  if (before.type === "mix_keeper" && after.type === "mix_keeper") compare("the stock share", before.stockPct, after.stockPct);
  if (before.type === "earnings" && after.type === "earnings") {
    compare("the pre-earnings window", before.buyDaysBefore, after.buyDaysBefore, " days");
    compare("the post-earnings window", before.sellDaysAfter, after.sellDaysAfter, " days");
  }
  return notes.length > 0 ? notes.join(" ") : null;
}

/**
 * Turns `goal` into a validated, bounded `Rule`. Throws `RuleRefusal` (a plain explanation, not
 * a generic fault) when the model names a symbol that isn't tradeable on `chain` right now;
 * otherwise clamps any out-of-bounds number and says so in the returned explanation rather than
 * refusing the whole request over one wild slider.
 */
export async function parseRuleGoal(chain: StaxChain, goal: string): Promise<{ rule: Rule; explanation: string }> {
  const universe = investableAssets(chain).map((a) => a.symbol);

  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: ParsedRuleSchema,
    system: systemPrompt(universe),
    prompt: [`Goal: ${goal}`, "Pick the one rule type that matches and set sensible numbers."].join("\n"),
  });

  const raw = object.rule as Rule;
  // RULES_NEEDING_HOLDINGS is empty today (every rule type can act) — this stays as the shared
  // gate so a future rule type that can't act yet has one place to list itself, and Vera never
  // proposes a rule `POST /api/autopilot` would then reject (review finding #5).
  if (RULES_NEEDING_HOLDINGS.includes(raw.type)) {
    throw new RuleRefusal(RULE_COMING_SOON_REASON);
  }
  const bad = symbolsIn(raw).find((s) => !universe.includes(s));
  if (bad) {
    throw new RuleRefusal(`${bad} isn't tradeable on ${chain.name} right now, so Vera can't set up that rule for it.`);
  }

  const rule = sanitizeRule(raw);
  const note = clampNote(raw, rule);
  return { rule, explanation: note ? `${object.explanation} ${note}` : object.explanation };
}
