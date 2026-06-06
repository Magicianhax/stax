import "server-only";

// buildAllocation — Vera's core allocation logic, shared by the interactive
// /api/allocate route and the autonomous Autopilot executor. Turns a plain
// goal + amount into a validated, normalized allocation over BUYABLE assets.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { AllocationSchema, type Allocation } from "@/lib/allocation-schema";
import { ALL_ASSETS } from "@/lib/mantle";
import { displayFor } from "@/lib/displayAssets";

const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

// Only assets that are actually buyable in one tap (exclude `coming` tiers).
const BUYABLE = ALL_ASSETS.filter((a) => !displayFor(a.symbol).coming);
const ALLOWED_SYMBOLS = new Set(BUYABLE.map((a) => a.symbol));

function systemPrompt(): string {
  const universe = BUYABLE.map((a) => `${a.symbol} — ${a.name} [${a.tier}]`).join("; ");
  return [
    "You are Stax, an AI investing copilot on the Mantle blockchain.",
    "You turn a person's plain-language goal into a concrete portfolio of REAL tokenized assets they can buy in one tap.",
    "",
    "RULES:",
    `- Allocate ONLY across these available assets: ${universe}.`,
    "- Tiers: 'stock' = tokenized equities/ETFs (e.g. AAPL, TSLA, SPY, QQQ); 'safe' = yield-bearing dollar (sUSDe); 'crypto' = mETH / FBTC.",
    "- Weights MUST sum to exactly 100.",
    "- Diversify sensibly for the user's risk. Don't put everything in one volatile name unless they explicitly insist.",
    "- Map risk: cash/safe ~500-1500 bps; broad ETFs ~3000-4500; single tech stocks ~5000-7000; crypto ~7000-9000. riskScore is the blended portfolio risk.",
    "- Explain like the user has never invested before. Warm, concrete, zero jargon. Briefly note that sUSDe yield is variable and tokenized stocks track the real share price.",
    "- Writing style for ALL text fields (summary, rationale, each reason): short plain sentences. NEVER use em dashes ('—') or double hyphens ('--'); use commas, periods, colons, or parentheses instead. No marketing buzzwords (supercharge, seamless, unleash, world-class, etc.). Don't restate the goal back; get to the substance.",
  ].join("\n");
}

/**
 * Build a validated allocation. Throws if the model can't produce a usable plan.
 * Weights are filtered to known symbols and normalized to sum to 100.
 */
export async function buildAllocation(
  goal: string,
  amountUsd: number,
  riskTolerance?: string,
): Promise<Allocation> {
  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: AllocationSchema,
    system: systemPrompt(),
    prompt: [
      `Goal: ${goal}`,
      `Amount to invest: $${amountUsd}`,
      `Risk preference: ${riskTolerance ?? "infer from the goal"}`,
      "Build the allocation now.",
    ].join("\n"),
  });

  const filtered = object.allocations.filter((a) => ALLOWED_SYMBOLS.has(a.symbol));
  if (filtered.length === 0) {
    throw new Error("Could not build a valid allocation. Try rephrasing the goal.");
  }
  const total = filtered.reduce((s, a) => s + a.weightPct, 0);
  const normalized = filtered.map((a) => ({
    ...a,
    weightPct: total > 0 ? Math.round((a.weightPct / total) * 10000) / 100 : 0,
  }));

  return { ...object, allocations: normalized };
}

export { MODEL as ALLOCATE_MODEL };
