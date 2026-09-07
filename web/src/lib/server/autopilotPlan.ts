import "server-only";

// Autopilot planning — what a run would buy, before any balance read or signing.
// Pure enough to exercise without a bundler or signer (it never imports the
// smart-account / bundler stack), which is also why it lives apart from the executor.
//
//   resolveAutopilotBasket(chain, id) — curated id first, then a stored short id
//   planForAutopilot(cfg)             — basket: fixed weights + ceiling check, no Vera;
//                                       goal: Vera's allocation for the saved goal
import { checkBasketCeiling, type AutopilotConfig } from "@/lib/autopilot";
import type { Allocation } from "@/lib/allocation-schema";
import { basketToAllocation, curatedBasketById, isBasketInvestable, isBasketShortId, type Basket } from "@/lib/baskets";
import { getChain, type StaxChain } from "@/lib/chains";
import { buildAllocation } from "@/lib/server/allocate";
import { getBasket } from "@/lib/server/basketsStore";

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
