import "server-only";

// Wires lib/rules.ts's pure evaluators to real BSC data — the piece that turns "if it drops 5%,
// move 50% to safety" into an actual plan of legs, or an honest "not yet" when this stream
// doesn't have what it needs.
//
// buy_discount is fully wired: it only needs the RWA catalog (lib/server/rwaCatalog.ts), which
// this stream already reads elsewhere. rebalance, safety_switch and mix_keeper also need the
// account's CURRENT per-asset holdings, and this stream owns no live balance reader for BSC —
// that's the `money` stream's Wallet API work (wave5 plan). Rather than guess, or read balances
// with machinery this stream doesn't own, `ctx.holdings` is an explicit optional input: absent,
// these three rules report a plain "waiting on your holdings" skip, same as `planForAutopilot`
// already does for a genuinely un-actionable state (a missing basket, a closed market). Once a
// caller supplies real holdings (wiringNeeded), the same evaluators run for real with no change
// here.
import {
  evaluateBuyDiscount,
  evaluateMixKeeper,
  evaluateRebalance,
  evaluateSafetySwitch,
  formatRuleReceipt,
  SAFER_SYMBOLS,
  type HoldingWeight,
  type Rule,
  type RuleIntent,
  type RuleType,
  type TieredHolding,
} from "@/lib/rules";
import type { StaxChain } from "@/lib/chains/types";
import { bscCatalogSnapshot } from "./rwaCatalog";
import { getSpreadHistory } from "./spreadStore";

/** How far the stock/crypto mix may drift from target before mix_keeper acts on it. */
const MIX_TOLERANCE_PCT = 5;
/** The ticker whose reference price stands in for "the market" for the safety switch. */
const MARKET_PROXY_TICKER = "SPY";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RuleRunContext {
  nowMs: number;
  /** This run's spending budget — the period's contribution, already inside the user's cap. */
  budgetUsd: number;
  /** Current USD value of everything the account holds, tier-tagged. See file header. */
  holdings?: TieredHolding[];
  /** Target weights for a rebalance rule — the basket it targets. */
  targets?: { symbol: string; weightPct: number }[];
  basketName?: string;
}

export type RulePlanResult = { ok: true; intents: RuleIntent[]; receipt: string } | { ok: false; reason: string };

const ok = (rule: Rule, intents: RuleIntent[], basketName?: string): RulePlanResult => ({
  ok: true,
  intents,
  receipt: formatRuleReceipt(rule, intents, basketName),
});
const skip = (reason: string): RulePlanResult => ({ ok: false, reason });

async function planBuyDiscount(chain: StaxChain, rule: Extract<Rule, { type: "buy_discount" }>, ctx: RuleRunContext): Promise<RulePlanResult> {
  const catalog = await bscCatalogSnapshot(ctx.nowMs);
  const ticker = catalog.tickers.find((t) => t.ticker === rule.symbol);
  const venue = ticker?.venues.find((v) => v.platform === ticker.bestVenue) ?? ticker?.venues[0];
  if (!ticker || !venue) {
    return skip(`${rule.symbol} isn't listed on ${chain.name} right now.`);
  }
  const intents = evaluateBuyDiscount({ symbol: rule.symbol, buyable: venue.buyable, gapPct: venue.gapPct }, rule.discountPct, ctx.budgetUsd);
  return ok(rule, intents);
}

function planRebalance(rule: Extract<Rule, { type: "rebalance" }>, ctx: RuleRunContext): RulePlanResult {
  if (!ctx.holdings) return skip("Waiting on your current holdings before Vera can rebalance.");
  if (!ctx.targets || ctx.targets.length === 0) return skip("Pick a basket for Vera to rebalance against.");
  const intents = evaluateRebalance(ctx.holdings as HoldingWeight[], ctx.targets, rule.driftPct, ctx.budgetUsd);
  return ok(rule, intents, ctx.basketName);
}

/**
 * SPY's one-day reference-price move, as a positive "dropped by N%" (0 or negative moves read
 * as no drop). Reads the same history the spread board already keeps (lib/server/spreadStore.ts)
 * — no extra Binance call. Null when there isn't enough history yet to compare.
 */
async function marketDropPct(chain: StaxChain): Promise<number | null> {
  const history = await getSpreadHistory(chain.key, MARKET_PROXY_TICKER, ["bstock", "ondo"]);
  const points = history.flatMap((h) => h.points).sort((a, b) => a.t - b.t);
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  const dayAgoTarget = latest.t - DAY_MS;
  const dayAgo = [...points].reverse().find((p) => p.t <= dayAgoTarget) ?? points[0];
  if (dayAgo.referencePrice <= 0 || dayAgo.t === latest.t) return null;
  const changePct = ((latest.referencePrice - dayAgo.referencePrice) / dayAgo.referencePrice) * 100;
  return changePct < 0 ? -changePct : 0;
}

async function planSafetySwitch(chain: StaxChain, rule: Extract<Rule, { type: "safety_switch" }>, ctx: RuleRunContext): Promise<RulePlanResult> {
  if (!ctx.holdings) return skip("Waiting on your current holdings before Vera can move anything to safety.");
  const drop = await marketDropPct(chain);
  if (drop === null) return skip("Couldn't read today's market move yet.");
  const stockHoldings = ctx.holdings.filter((h) => h.tier === "stock");
  const intents = evaluateSafetySwitch(stockHoldings, drop, rule.dropPct, rule.movePct, SAFER_SYMBOLS, ctx.budgetUsd);
  return ok(rule, intents);
}

function planMixKeeper(rule: Extract<Rule, { type: "mix_keeper" }>, ctx: RuleRunContext): RulePlanResult {
  if (!ctx.holdings) return skip("Waiting on your current holdings before Vera can keep the mix.");
  const intents = evaluateMixKeeper(ctx.holdings, rule.stockPct, MIX_TOLERANCE_PCT, ctx.budgetUsd);
  return ok(rule, intents);
}

/**
 * The rule types this engine actually evaluates — every pickable rule except `schedule_buy`,
 * which the caller (autopilotPlan.ts's `planAutopilotRun`) routes straight to the existing
 * goal/basket plan instead, unchanged.
 */
export type EvaluableRule = Exclude<Rule, { type: "schedule_buy" }>;

/**
 * Turns one rule into a plan: the buy/sell legs it calls for right now, and the plain receipt
 * line to record. Never signs or reads chain state itself — see file header for what still
 * needs wiring (rebalance, safety_switch, mix_keeper all need `ctx.holdings`).
 */
export async function planRuleForAutopilot(chain: StaxChain, rule: EvaluableRule, ctx: RuleRunContext): Promise<RulePlanResult> {
  switch (rule.type) {
    case "buy_discount":
      return planBuyDiscount(chain, rule, ctx);
    case "rebalance":
      return planRebalance(rule, ctx);
    case "safety_switch":
      return planSafetySwitch(chain, rule, ctx);
    case "mix_keeper":
      return planMixKeeper(rule, ctx);
    case "earnings":
      // nextEarningsMs has no data source yet (wiringNeeded) — never guess a date.
      return skip(`Vera can't trade ${rule.symbol} around earnings yet; the earnings calendar isn't connected.`);
  }
}

export type { RuleType };
