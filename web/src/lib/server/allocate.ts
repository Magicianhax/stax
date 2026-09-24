import "server-only";

// buildAllocation — Vera's core allocation logic, shared by the interactive
// /api/allocate route and the autonomous Autopilot executor. Turns a plain
// goal + amount into a validated, normalized allocation over the assets that are
// actually BUYABLE on the requested chain (`investableAssets(chain)` — never
// `coming` tiers).
//
// BSC (Task 12): Vera's candidate universe there is narrower than "listed" — the market can
// be closed, or an issuer can be paused, right when the plan is being built. The universe is
// filtered to `bscPlan.buyableTickers` before the model ever sees it, the unbuyable names are
// named in the prompt so Vera can explain herself, and the leg count is capped to
// `maxBscLegs(amountUsd)` before AND after the call (Global Constraint: $6 minimum per leg,
// Review Focus #3) so a "$20 across 5 stocks" goal fails here, at planning, not mid-execution.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { AllocationSchema, type Allocation } from "@/lib/allocation-schema";
import { investableAssets } from "@/lib/chains";
import type { Asset, StaxChain } from "@/lib/chains/types";
import { AllocationRefusal, allClosedMessage, buyableTickers, enforceMinLegs, maxBscLegs, unavailableNote, venueAddressFor } from "./bscPlan";
import { bscCatalogSnapshot } from "./rwaCatalog";
import { BSC_MIN_LEG_USD, type RwaTickerView } from "@/lib/rwa";

const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

function tierLine(tier: Asset["tier"], assets: Asset[]): string | null {
  const list = assets.filter((a) => a.tier === tier).map((a) => a.symbol);
  if (list.length === 0) return null;
  const label =
    tier === "stock" ? "'stock' = tokenized equities/ETFs" : tier === "safe" ? "'safe' = yield-bearing dollars" : "'crypto' = crypto exposure";
  return `${label} (${list.join(", ")})`;
}

/** BSC-only prompt context: the leg cap, the per-leg weight floor, and why any listed ticker isn't in the universe. */
interface BscPromptInfo {
  maxLegs: number;
  minWeightPct: number;
  unavailable: string[];
}

function systemPrompt(chain: StaxChain, universe: Asset[], bsc?: BscPromptInfo): string {
  const list = universe.map((a) => `${a.symbol} — ${a.name} [${a.tier}]`).join("; ");
  const tiers = (["stock", "safe", "crypto"] as const).map((t) => tierLine(t, universe)).filter(Boolean).join("; ");
  const safe = universe.filter((a) => a.tier === "safe");
  const safeRule =
    safe.length > 0
      ? `- For the low-risk / 'keep some cash safe' part of a plan, use the 'safe' tier (${safe.map((a) => `${a.symbol} = ${a.name}`).join(", ")}). It earns yield and does not move like a stock.`
      : "- There is no yield 'safe' dollar available on this chain right now. If the user wants to play it safe or keep some money low-risk, lean on broad ETFs or the steadiest large names in the list; never invent an asset that is not in the list above.";

  const bscRules = bsc
    ? [
        `- Use AT MOST ${bsc.maxLegs} of the assets above in this plan (never more): Binance rejects a trade under $6, so more names than that would size some legs too small for the amount given.`,
        `- Give every pick you DO include at least ${bsc.minWeightPct}% of the total weight: anything smaller would size that leg under Binance's $6 minimum for this amount, and the plan would be shrunk (or refused) to fix it. Leave a name out entirely rather than give it a token weight.`,
        ...(bsc.unavailable.length > 0
          ? [
              `- These names are NOT in the list above and must never be picked, because they aren't tradeable right now: ${bsc.unavailable.join("; ")}. If the user's goal mentions one of them by name, say in your rationale that it's temporarily unavailable (market closed or paused) and suggest a close alternative from the list instead.`,
            ]
          : []),
      ]
    : [];

  return [
    `You are Stax, an AI investing copilot on the ${chain.name} blockchain.`,
    `You turn a person's plain-language goal into a concrete portfolio of REAL tokenized assets they can buy in one tap. The stocks are ${chain.issuer} on ${chain.name}; each token tracks the real share price.`,
    "",
    "RULES:",
    `- Allocate ONLY across these available assets on ${chain.name}: ${list}.`,
    `- Tiers: ${tiers}.`,
    safeRule,
    ...bscRules,
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
  let universe = investableAssets(chain);
  let bscInfo: BscPromptInfo | undefined;
  let catalogBySymbol: Map<string, RwaTickerView> | undefined;

  if (chain.key === "bsc") {
    const catalog = await bscCatalogSnapshot(Date.now());
    const buyable = buyableTickers(catalog.tickers);
    if (buyable.length === 0) {
      throw new AllocationRefusal(allClosedMessage(catalog.tickers, Date.now()));
    }
    const buyableSymbols = new Set(buyable.map((t) => t.ticker));
    universe = universe.filter((a) => buyableSymbols.has(a.symbol));
    catalogBySymbol = new Map(catalog.tickers.map((t) => [t.ticker, t]));
    const maxLegs = maxBscLegs(amountUsd);
    if (maxLegs === 0) {
      throw new AllocationRefusal(`$${amountUsd} is below Binance's $6 minimum per stock.`);
    }
    bscInfo = {
      maxLegs,
      // ceil so a pick right at the boundary still clears $6 after rounding, not just meets it.
      minWeightPct: Math.ceil((BSC_MIN_LEG_USD / amountUsd) * 100),
      unavailable: catalog.tickers.filter((t) => !buyableSymbols.has(t.ticker)).map((t) => unavailableNote(t, Date.now())),
    };
  }

  if (universe.length === 0) {
    throw new Error(`No investable assets are live on ${chain.name} yet.`);
  }
  const allowed = new Set(universe.map((a) => a.symbol));

  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: AllocationSchema,
    system: systemPrompt(chain, universe, bscInfo),
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

  if (!bscInfo || !catalogBySymbol) {
    return { ...object, allocations: normalized };
  }

  // Enforce the $6 floor again on what the model actually returned (Review Focus #3): drop
  // the smallest legs down to the cap and renormalise, refusing outright rather than ever
  // sending a leg the direct path would just refuse anyway at invest time.
  const bySymbol = catalogBySymbol;
  const candidateLegs = normalized.map((a) => ({ ...a, usd: (a.weightPct / 100) * amountUsd }));
  const capped = enforceMinLegs(candidateLegs, amountUsd);
  if (!capped.ok) {
    throw new AllocationRefusal(capped.message);
  }
  const allocations = capped.legs.map((l) => {
    const ticker = bySymbol.get(l.symbol);
    const address = venueAddressFor(ticker);
    return {
      symbol: l.symbol,
      weightPct: Math.round((l.usd / amountUsd) * 10000) / 100,
      reason: l.reason,
      ...(ticker?.bestVenue ? { venue: ticker.bestVenue } : {}),
      ...(address ? { address } : {}),
    };
  });

  return { ...object, allocations };
}

export { MODEL as ALLOCATE_MODEL };
export { AllocationRefusal };
