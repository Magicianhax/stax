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
import { investableAssets, isRoutable } from "@/lib/chains";
import { riskScoreFor } from "@/lib/baskets";
import type { Asset, StaxChain } from "@/lib/chains/types";
import {
  AllocationRefusal,
  allClosedMessage,
  applyCryptoMix,
  buyableTickers,
  enforceMinLegs,
  maxBscLegs,
  minLegFloorMessage,
  parseCryptoMix,
  planChangeNote,
  roundLegWeights,
  unavailableNote,
  venueAddressFor,
  withoutUnaskedRisk,
  type CryptoMixRequest,
} from "./bscPlan";
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
  /** Set only when the user's goal actually asked for a stocks/crypto mix (Wave 5 direction B). */
  cryptoMix?: CryptoMixRequest;
  /** True when every stock market is shut right now AND crypto was asked for — see bscRules below. */
  stocksClosed?: boolean;
  /** True when the goal names only crypto ("put $50 in bitcoin"): no stock is in the list at all. */
  cryptoOnly?: boolean;
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
        ...(bsc.cryptoOnly
          ? [
              `- The user asked for crypto only, so no 'stock' tier asset is in the list above at all: put the whole plan into the 'crypto' tier picks.`,
            ]
          : [])
        ,
        ...(bsc.stocksClosed
          ? [
              `- Every stock market is closed right now, so no 'stock' tier asset is in the list above at all: this plan can ONLY use 'crypto' tier picks. Say plainly in your rationale that the stock market is shut right now and this plan puts the money into crypto instead.`,
            ]
          : bsc.cryptoMix
            ? [
                `- The user asked for about ${bsc.cryptoMix.cryptoPct}% crypto and ${100 - bsc.cryptoMix.cryptoPct}% stocks. Split the total weight close to that: 'crypto' tier picks should add up near ${bsc.cryptoMix.cryptoPct}%, 'stock' tier picks near ${100 - bsc.cryptoMix.cryptoPct}%.`,
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
    const buyableSymbols = new Set(buyable.map((t) => t.ticker));
    // Stock names the goal may mention beside crypto ("NVDA and bitcoin"), so only a goal that names
    // crypto alone is read as crypto-only.
    const stockNames = chain.assets.all.filter((a) => a.tier === "stock").flatMap((a) => [a.symbol, a.name]);
    let cryptoMix = parseCryptoMix(goal, stockNames) ?? undefined;
    // Crypto has no market hours and isn't in the RWA catalog at all, so it's judged solely by
    // isRoutable (always tradeable) rather than the stock catalog's buyable-right-now gate — and
    // it only joins Vera's universe when the goal actually asked for it (default: stocks only).
    const cryptoUniverse = cryptoMix ? chain.assets.crypto.filter((a) => isRoutable(chain, a.symbol)) : [];
    // Every BSC gate must treat crypto as always tradeable (Wave 5 direction A), so "all
    // buyable" is computed across BOTH universes before the all-closed refusal fires — a
    // weekend "put $50 in bitcoin" must still get a plan even though every stock is shut.
    if (buyable.length === 0 && cryptoUniverse.length === 0) {
      throw new AllocationRefusal(allClosedMessage(catalog.tickers, Date.now()));
    }
    // Stocks are shut but crypto was asked for and is available: the whole amount goes to
    // crypto rather than honouring a stocks/crypto split against a stock universe that's
    // empty right now (a strict 80/20 read would otherwise leave 80% of the money unallocated).
    const stocksClosed = buyable.length === 0;
    if (stocksClosed && cryptoMix) {
      cryptoMix = { cryptoPct: 100 };
    }
    // Leveraged funds stay out unless the goal asks for them (design critique P1 #6).
    const cryptoOnly = Boolean(cryptoMix) && cryptoMix!.cryptoPct >= 100 && cryptoUniverse.length > 0;
    universe = [
      ...(cryptoOnly ? [] : withoutUnaskedRisk(universe.filter((a) => buyableSymbols.has(a.symbol)), goal)),
      ...cryptoUniverse,
    ];
    catalogBySymbol = new Map(catalog.tickers.map((t) => [t.ticker, t]));
    const maxLegs = maxBscLegs(amountUsd);
    if (maxLegs === 0) {
      throw new AllocationRefusal(minLegFloorMessage(1));
    }
    bscInfo = {
      maxLegs,
      // ceil so a pick right at the boundary still clears $6 after rounding, not just meets it.
      minWeightPct: Math.ceil((BSC_MIN_LEG_USD / amountUsd) * 100),
      unavailable: catalog.tickers.filter((t) => !buyableSymbols.has(t.ticker)).map((t) => unavailableNote(t, Date.now())),
      cryptoMix,
      stocksClosed: stocksClosed && Boolean(cryptoMix),
      cryptoOnly: cryptoOnly && !stocksClosed,
    };
  }

  if (universe.length === 0) {
    throw new Error(`No investable assets are live on ${chain.name} yet.`);
  }
  const allowed = new Set(universe.map((a) => a.symbol));
  const assetsBySymbol = new Map(universe.map((a) => [a.symbol, a]));

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
  let normalized = filtered.map((a) => ({
    ...a,
    weightPct: total > 0 ? Math.round((a.weightPct / total) * 10000) / 100 : 0,
  }));

  if (!bscInfo || !catalogBySymbol) {
    return { ...object, allocations: normalized };
  }

  // Direction B: a pure post-check on what the model actually returned, in case it didn't
  // follow the ratio rule above (or ignored the crypto ask entirely). Runs before the $6-floor
  // pass below, which still has the final word — a ratio correction can still shrink once
  // under-$6 legs are dropped.
  if (bscInfo.cryptoMix) {
    normalized = applyCryptoMix(chain, normalized, bscInfo.cryptoMix);
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
  // Weights that sum to exactly 100.00 with the slack on the largest leg, so the invest-time
  // split (which divides by the weights' own sum) can't size a $6.00 leg at $5.9994.
  const weights = roundLegWeights(capped.legs.map((l) => l.usd), amountUsd);
  const allocations = capped.legs.map((l, i) => {
    const asset = assetsBySymbol.get(l.symbol);
    // Crypto isn't an RWA token, so it has no catalog venue to resolve — its address comes
    // straight from the chain's own asset registry instead.
    if (asset?.tier === "crypto") {
      return {
        symbol: l.symbol,
        weightPct: weights[i],
        reason: l.reason,
        ...(asset.address ? { address: asset.address } : {}),
      };
    }
    const ticker = bySymbol.get(l.symbol);
    const address = venueAddressFor(ticker);
    return {
      symbol: l.symbol,
      weightPct: weights[i],
      reason: l.reason,
      ...(ticker?.bestVenue ? { venue: ticker.bestVenue } : {}),
      ...(address ? { address } : {}),
    };
  });

  // The model wrote its summary, rationale and risk before the server dropped legs under the floor
  // or added a crypto leg for the requested mix. Say what changed, and never let the risk meter
  // sit below what the final legs imply (a 4-name "Balanced" plan cut to one stock isn't).
  const note = planChangeNote({
    modelSymbols: filtered.map((a) => a.symbol),
    finalSymbols: allocations.map((a) => a.symbol),
    nameOf: (s) => assetsBySymbol.get(s)?.name ?? s,
  });
  return {
    ...object,
    ...(note ? { rationale: `${object.rationale} ${note}` } : {}),
    riskScore: Math.min(10_000, Math.max(object.riskScore, riskScoreFor(chain, allocations))),
    allocations,
  };
}

export { MODEL as ALLOCATE_MODEL };
export { AllocationRefusal };
