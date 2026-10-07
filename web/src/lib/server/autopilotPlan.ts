import "server-only";

// Autopilot planning — what a run would buy, before any balance read or signing.
// Pure enough to exercise without a bundler or signer (it never imports the
// smart-account / bundler stack), which is also why it lives apart from the executor.
//
//   resolveAutopilotBasket(chain, id) — curated id first, then a stored short id
//   planForAutopilot(cfg)             — basket: fixed weights + ceiling check, no Vera;
//                                       goal: Vera's allocation for the saved goal
//   planAutopilotRun(cfg)             — the entry point autopilotExecutor.ts calls: unwraps a
//                                       rule encoded in `goal` (lib/rules.ts) and routes it to
//                                       the rule engine, or falls through to planForAutopilot
//                                       unchanged for every plain goal/basket autopilot
import { checkBasketCeiling, type AutopilotConfig } from "@/lib/autopilot";
import type { Allocation } from "@/lib/allocation-schema";
import { basketToAllocation, curatedBasketById, isBasketInvestable, isBasketShortId, type Basket } from "@/lib/baskets";
import { getChain, type StaxChain } from "@/lib/chains";
import { decodeRuleGoal, HOLDINGS_RULE_TYPES, type Rule, type RuleIntent } from "@/lib/rules";
import { buildAllocation } from "@/lib/server/allocate";
import { getBasket } from "@/lib/server/basketsStore";
import { getBscHoldings } from "@/lib/server/bscHoldings";
import { planRuleForAutopilot, type EvaluableRule } from "@/lib/server/rulesEngine";

const RISK_CEILING_BPS = 10000;
const clampRisk = (bps: number) => Math.max(0, Math.min(RISK_CEILING_BPS, Math.round(bps)));

export const BASKET_GONE = "Basket no longer exists";

export type BasketLookup =
  | { kind: "found"; basket: Basket }
  | { kind: "uninvestable"; basket?: Basket; reason: string }
  | { kind: "missing" };

/**
 * Resolve an autopilot's basket target on `chain`: a curated id first (in code, never
 * deleted), then a stored basket by short id (re-validated against today's registry).
 * "uninvestable" = the basket exists but holds something not buyable on this chain today.
 */
export async function resolveAutopilotBasket(chain: StaxChain, basketId: string): Promise<BasketLookup> {
  const curated = curatedBasketById(chain.key, basketId);
  if (curated) {
    return isBasketInvestable(chain, curated)
      ? { kind: "found", basket: curated }
      : { kind: "uninvestable", basket: curated, reason: `This basket holds something you can't buy on ${chain.name} right now.` };
  }
  if (!isBasketShortId(basketId)) return { kind: "missing" };
  const stored = await getBasket(basketId);
  if (!stored) return { kind: "missing" };
  // The row exists but today's registry refuses it (a holding is no longer routable): skip, don't pause.
  if (!stored.ok) return { kind: "uninvestable", reason: stored.reason };
  if (stored.basket.chain !== chain.key) return { kind: "missing" };
  return { kind: "found", basket: stored.basket };
}

export type AutopilotPlan =
  | { ok: true; allocation: Allocation; assessedRiskBps: number; basket?: Basket }
  | {
      ok: false;
      status: "skipped" | "error";
      reason: string;
      /** The autopilot should stop scheduling itself (its target is gone). */
      pause?: boolean;
      basket?: Basket;
      assessedRiskBps?: number;
    };

/**
 * What this run would buy, before any balance read or signing. Basket autopilots never
 * call Vera: the basket's fixed weights become the allocation, and its risk is checked
 * against the ceiling right here (checkBasketCeiling). Goal autopilots ask Vera; their
 * risk is gated later by checkBounds with the balance in hand.
 */
export async function planForAutopilot(cfg: AutopilotConfig, chain: StaxChain = getChain(cfg.chain)): Promise<AutopilotPlan> {
  // ADR-0005: Autopilot only ever runs through the executor, with its on-chain risk gate. A
  // chain's direct smart-account path is a user-present flow; a scheduled run has no one
  // watching, so a sizing mistake there would repeat silently every period. BSC's executor is live
  // since 2026-10-07, so BSC passes; any chain without one stays off. `runAutopilot` already checks
  // this before it ever calls here; this mirrors it so nothing that calls `planForAutopilot`
  // directly (a future preview endpoint, a test) can skip the gate by accident.
  if (!chain.contracts.deployed) {
    return { ok: false, status: "skipped", reason: `Stax is not deployed on ${chain.name} yet.` };
  }
  if (cfg.basketId) {
    const found = await resolveAutopilotBasket(chain, cfg.basketId);
    if (found.kind === "missing") return { ok: false, status: "error", reason: BASKET_GONE, pause: true };
    if (found.kind === "uninvestable") return { ok: false, status: "skipped", reason: found.reason, basket: found.basket };
    const basket = found.basket;
    // A plain Allocation (not the AllocateResult extras) — recHash/planId hash this object.
    const { summary, rationale, riskScore, allocations } = basketToAllocation(basket, cfg.amountUsd);
    const allocation: Allocation = { summary, rationale, riskScore, allocations };
    const assessedRiskBps = clampRisk(allocation.riskScore);
    const ceiling = checkBasketCeiling(assessedRiskBps, cfg.riskCeilingBps);
    if (!ceiling.ok) return { ok: false, status: "skipped", reason: ceiling.reason!, basket, assessedRiskBps };
    return { ok: true, allocation, assessedRiskBps, basket };
  }
  const allocation = await buildAllocation(chain, cfg.goal, cfg.amountUsd);
  return { ok: true, allocation, assessedRiskBps: clampRisk(allocation.riskScore) };
}

/** What one rule-based run produced — the shape `planForAutopilot` can't return (buy/sell legs
 *  and a plain receipt, not an `Allocation`). See planAutopilotRun. */
export type AutopilotRulePlan =
  | { ok: true; kind: "rule"; rule: Rule; intents: RuleIntent[]; receipt: string }
  | { ok: false; kind: "rule"; status: "skipped" | "error"; reason: string; pause?: boolean };

/**
 * The entry point autopilotExecutor.ts calls instead of `planForAutopilot` directly. Every
 * existing autopilot's `goal` is plain text — `decodeRuleGoal` returns null for it, and this
 * falls straight through to `planForAutopilot`, unchanged. A config whose goal carries an
 * encoded rule (lib/rules.ts, saved by /api/autopilot) is routed to the rule engine instead,
 * except `schedule_buy` — that rule type IS today's goal/basket plan, so it just unwraps back to
 * the human-readable goal and runs the normal path. Same `chain.contracts.deployed` gate as
 * `planForAutopilot`: a rule never evaluates while the BSC executor is off.
 */
export async function planAutopilotRun(
  cfg: AutopilotConfig,
  chain: StaxChain = getChain(cfg.chain),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<AutopilotPlan | AutopilotRulePlan> {
  // Rules other than "buy on a schedule" are BSC-only (file header, review finding #3): decoding
  // on any chain would let a `goal` crafted or copied onto a Base/Mantle config — both already
  // `deployed: true` — run today, reading BSC's own catalog/spread data to trade on a different
  // chain entirely. `/api/autopilot`'s POST already refuses saving one off BSC; this is the
  // second, independent gate for a row that reached the column some other way.
  const decoded = chain.key === "bsc" ? decodeRuleGoal(cfg.goal) : null;
  if (!decoded || decoded.rule.type === "schedule_buy") {
    const effectiveGoal = decoded?.displayGoal ?? cfg.goal;
    return planForAutopilot(effectiveGoal === cfg.goal ? cfg : { ...cfg, goal: effectiveGoal }, chain);
  }

  if (!chain.contracts.deployed) {
    return { ok: false, kind: "rule", status: "skipped", reason: `Stax is not deployed on ${chain.name} yet.` };
  }

  let targets: { symbol: string; weightPct: number }[] | undefined;
  let basketName: string | undefined;
  if (cfg.basketId) {
    const found = await resolveAutopilotBasket(chain, cfg.basketId);
    if (found.kind === "missing") return { ok: false, kind: "rule", status: "error", reason: BASKET_GONE, pause: true };
    if (found.kind === "found") {
      targets = found.basket.items.map((i) => ({ symbol: i.symbol, weightPct: i.weightPct }));
      basketName = found.basket.name;
    }
    // "uninvestable" falls through with no targets: the rule engine's own "pick a basket" /
    // holdings message still applies, and this stays a skip rather than a pause (the basket
    // itself is fine, just not tradeable on this chain right this moment).
  }

  const rule = decoded.rule as EvaluableRule;
  // Only the three holdings-based rule types ever look at ctx.holdings (rulesEngine.ts) — a live
  // BSC balance read is a Wallet API call plus a fresh RWA catalog pull, so it's only worth paying
  // for when the rule actually needs it (buy_discount and earnings never do).
  const holdings = HOLDINGS_RULE_TYPES.includes(rule.type)
    ? ((await getBscHoldings(chain, cfg.smartAccount, nowSeconds * 1000)) ?? undefined)
    : undefined;
  const result = await planRuleForAutopilot(chain, rule, { nowMs: nowSeconds * 1000, budgetUsd: cfg.amountUsd, targets, basketName, holdings, lastRunMs: cfg.lastRunAt !== undefined ? cfg.lastRunAt * 1000 : undefined });
  if (!result.ok) return { ok: false, kind: "rule", status: "skipped", reason: result.reason };
  return { ok: true, kind: "rule", rule, intents: result.intents, receipt: result.receipt };
}
