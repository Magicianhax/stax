import "server-only";

// buildAllocation — Vera's core allocation logic, shared by the interactive
// /api/allocate route and the autonomous Autopilot executor. Turns a plain
// goal + amount into a validated, normalized allocation over the assets that are
// actually BUYABLE on the requested chain (`investableAssets(chain)` — never
// `coming` tiers).
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { AllocationSchema, type Allocation } from "@/lib/allocation-schema";
import { investableAssets } from "@/lib/chains";
import type { Asset, StaxChain } from "@/lib/chains/types";

const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

function tierLine(tier: Asset["tier"], assets: Asset[]): string | null {
  const list = assets.filter((a) => a.tier === tier).map((a) => a.symbol);
  if (list.length === 0) return null;
  const label =
    tier === "stock" ? "'stock' = tokenized equities/ETFs" : tier === "safe" ? "'safe' = yield-bearing dollars" : "'crypto' = crypto exposure";
  return `${label} (${list.join(", ")})`;
}

function systemPrompt(chain: StaxChain, universe: Asset[]): string {
  const list = universe.map((a) => `${a.symbol} — ${a.name} [${a.tier}]`).join("; ");
  const tiers = (["stock", "safe", "crypto"] as const).map((t) => tierLine(t, universe)).filter(Boolean).join("; ");
  const safe = universe.filter((a) => a.tier === "safe");
  const safeRule =
    safe.length > 0
      ? `- For the low-risk / 'keep some cash safe' part of a plan, use the 'safe' tier (${safe.map((a) => `${a.symbol} = ${a.name}`).join(", ")}). It earns yield and does not move like a stock.`
      : "- There is no yield 'safe' dollar available on this chain right now. If the user wants to play it safe or keep some money low-risk, lean on broad ETFs or the steadiest large names in the list; never invent an asset that is not in the list above.";

  return [
    `You are Stax, an AI investing copilot on the ${chain.name} blockchain.`,
    `You turn a person's plain-language goal into a concrete portfolio of REAL tokenized assets they can buy in one tap. The stocks are ${chain.issuer} on ${chain.name}; each token tracks the real share price.`,
    "",
    "RULES:",
    `- Allocate ONLY across these available assets on ${chain.name}: ${list}.`,
    `- Tiers: ${tiers}.`,
    safeRule,
    "- Weights MUST sum to exactly 100.",
    "- Diversify sensibly for the user's risk. Don't put everything in one volatile name unless they explicitly insist.",
    "- Map risk: safe dollars ~500-1500; broad ETFs ~3000-4500; single tech stocks ~5000-7000; crypto ~7000-9000. riskScore is the blended portfolio risk.",
    `- Explain like the user has never invested before. Warm, concrete, zero jargon. Briefly note that these are ${chain.issuer} that track the real share price.`,
    "- Writing style for ALL text fields (summary, rationale, each reason): short plain sentences. NEVER use em dashes ('—') or double hyphens ('--'); use commas, periods, colons, or parentheses instead. No marketing buzzwords (supercharge, seamless, unleash, world-class, etc.). Don't restate the goal back; get to the substance.",
  ].join("\n");
}

/**
 * Build a validated allocation for `chain`. Throws if the model can't produce a
 * usable plan. Weights are filtered to that chain's investable symbols and
 * normalized to sum to 100.
 */
export async function buildAllocation(
  chain: StaxChain,
  goal: string,
  amountUsd: number,
  riskTolerance?: string,
): Promise<Allocation> {
  const universe = investableAssets(chain);
  if (universe.length === 0) {
    throw new Error(`No investable assets are live on ${chain.name} yet.`);
  }
  const allowed = new Set(universe.map((a) => a.symbol));

  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: AllocationSchema,
    system: systemPrompt(chain, universe),
    prompt: [
      `Chain: ${chain.name} (${chain.issuer})`,
      `Goal: ${goal}`,
      `Amount to invest: $${amountUsd}`,
      `Risk preference: ${riskTolerance ?? "infer from the goal"}`,
      "Build the allocation now.",
    ].join("\n"),
  });

  const filtered = object.allocations.filter((a) => allowed.has(a.symbol));
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
