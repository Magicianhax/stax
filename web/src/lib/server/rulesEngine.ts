import "server-only";

// Wires lib/rules.ts's pure evaluators to real BSC data — the piece that turns "if it drops 5%,
// move 50% to safety" into an actual plan of legs, or an honest "not yet" when this stream
// doesn't have what it needs.
//
// buy_discount is fully wired: it only needs the RWA catalog (lib/server/rwaCatalog.ts), which
// this stream already reads elsewhere. rebalance, safety_switch and mix_keeper also need the
// account's CURRENT per-asset holdings; `ctx.holdings` is an explicit optional input — absent
// (the caller's balance read failed, or hasn't run), these three rules report a plain "waiting on
// your holdings" skip, same as `planForAutopilot` already does for a genuinely un-actionable state
// (a missing basket, a closed market). `autopilotPlan.ts` supplies real holdings from
// `lib/server/bscHoldings.ts` for exactly these three rule types (`HOLDINGS_RULE_TYPES`).
//
// Sell intents, once holdings are known: `contracts/contracts/StaxExecutor.sol`'s only entry
// point, `investWithAI`, pulls USDC from the caller and forwards the tokens it buys back to them —
// there is no function anywhere in that contract that pulls an ERC20 token FROM the user and
// swaps it back to cash. A rule's sell leg can therefore never actually execute on this chain, and
// `autopilotExecutor.ts` refuses one outright rather than pretend otherwise (see its own header).
// Rather than leave rebalance/safety_switch/mix_keeper permanently "coming soon" for a limitation
// that has nothing to do with holdings, each one below runs its pure evaluator (lib/rules.ts)
// UNCAPPED (`UNCAPPED_BUDGET` — big enough that the sell/buy pairing those evaluators do never
// binds), to see how far the account has genuinely drifted, then keeps only the resulting BUY
// legs — funded by this run's own new cash, not by a sale that can't happen — and drops every
// sell (`buyOnly`, capped at the period's real budget like every other rule). The overweight side
// is simply left alone until the day the executor can sell.
import {
  evaluateBuyDiscount,
  evaluateMixKeeper,
  evaluateRebalance,
  evaluateEarnings,
  evaluateSafetySwitch,
  formatRuleReceipt,
  SAFER_SYMBOLS,
  type HoldingWeight,
  type Rule,
  type RuleIntent,
  type RuleType,
  type TieredHolding,
} from "@/lib/rules";
import { classifySpread } from "@/lib/spread";
import { assetBySymbol } from "@/lib/chains";
import { resolveVenueAddress } from "@/lib/venues";
import type { StaxChain } from "@/lib/chains/types";
import type { RwaTickerView, VenueView } from "@/lib/rwa";
import { bscCatalogSnapshot } from "./rwaCatalog";
import { getSpreadHistory } from "./spreadStore";
import { getNextEarnings } from "./earnings";

/** How far the stock/crypto mix may drift from target before mix_keeper acts on it. */
const MIX_TOLERANCE_PCT = 5;
/** The ticker whose reference price stands in for "the market" for the safety switch. */
const MARKET_PROXY_TICKER = "SPY";
const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Passed as `budgetUsd` to a pure evaluator (lib/rules.ts) so its own sell/buy budget cap never
 * binds — the real cap is applied afterward by `buyOnly`, against actual cash rather than a sale
 * that can't happen (see this file's header).
 */
const UNCAPPED_BUDGET = Number.MAX_SAFE_INTEGER;

/**
 * Keeps only the buy legs from an evaluator's sell+buy output, capped at `budgetUsd` (this run's
 * real new cash), scaling every buy down together if the uncapped total is more than that budget
 * affords. See this file's header for why a sell can never be kept.
 */
function buyOnly(intents: readonly RuleIntent[], budgetUsd: number): RuleIntent[] {
  const buys = intents.filter((i) => i.action === "buy");
  const total = buys.reduce((s, i) => s + i.usd, 0);
  if (total <= 0 || total <= budgetUsd) return buys;
  const scale = budgetUsd / total;
  return buys.map((b) => ({ ...b, usd: round2(b.usd * scale) }));
}

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

/**
 * Which venue actually shows the discount, and whether Vera can buy it. `bestVenue` (the
 * catalog's own pick) is the buyable venue with the SMALLEST |gap| — the closest to par, i.e.
 * the LEAST likely to be a discount — so a real -3% on the twin is missed whenever the primary
 * sits at -0.5%. Every venue is checked instead, through the same classifySpread the issuer
 * board uses, and the most-negative buyable gap wins (review finding #2). The executor's shared
 * leg-building pipeline (lib/legBuilder.ts, outside this stream) always buys the asset's own
 * default address, though — it has no way to route to the twin's — so a discount that only
 * lives on the twin is refused rather than silently bought at the wrong address.
 */
function pickDiscountVenue(ticker: Pick<RwaTickerView, "venues">, discountPct: number): VenueView | null {
  const discounted = ticker.venues.filter((v) => classifySpread(v, { discountPct }).label === "discount");
  if (discounted.length === 0) return null;
  return discounted.reduce((best, v) => ((v.gapPct ?? 0) < (best.gapPct ?? 0) ? v : best));
}

async function planBuyDiscount(chain: StaxChain, rule: Extract<Rule, { type: "buy_discount" }>, ctx: RuleRunContext): Promise<RulePlanResult> {
  const catalog = await bscCatalogSnapshot(ctx.nowMs);
  const ticker = catalog.tickers.find((t) => t.ticker === rule.symbol);
  if (!ticker || ticker.venues.length === 0) {
    return skip(`${rule.symbol} isn't listed on ${chain.name} right now.`);
  }
  const best = pickDiscountVenue(ticker, rule.discountPct);
  if (!best) return ok(rule, []); // a real, successful check that found no discount right now

  const asset = assetBySymbol(chain, rule.symbol);
  if (!asset) return skip(`${rule.symbol} isn't listed on ${chain.name} right now.`);
  const resolved = resolveVenueAddress(chain, asset, best.platform);
  if (!resolved || resolved.address.toLowerCase() !== asset.address?.toLowerCase()) {
    // The discount lives on the twin (or an issuer venues.ts can't map at all) — see this
    // function's header for why that can't be bought yet.
    return skip(`${rule.symbol} is cheaper via its other issuer right now, which Vera can't buy for this rule yet.`);
  }
  const intents = evaluateBuyDiscount(
    { symbol: rule.symbol, buyable: best.buyable, gapPct: best.gapPct, platform: best.platform },
    rule.discountPct,
    ctx.budgetUsd,
  );
  return ok(rule, intents);
}

function planRebalance(rule: Extract<Rule, { type: "rebalance" }>, ctx: RuleRunContext): RulePlanResult {
  if (!ctx.holdings) return skip("Waiting on your current holdings before Vera can rebalance.");
  if (!ctx.targets || ctx.targets.length === 0) return skip("Pick a basket for Vera to rebalance against.");
  const uncapped = evaluateRebalance(ctx.holdings as HoldingWeight[], ctx.targets, rule.driftPct, UNCAPPED_BUDGET);
  return ok(rule, buyOnly(uncapped, ctx.budgetUsd), ctx.basketName);
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
  const uncapped = evaluateSafetySwitch(stockHoldings, drop, rule.dropPct, rule.movePct, SAFER_SYMBOLS, UNCAPPED_BUDGET);
  return ok(rule, buyOnly(uncapped, ctx.budgetUsd));
}

function planMixKeeper(rule: Extract<Rule, { type: "mix_keeper" }>, ctx: RuleRunContext): RulePlanResult {
  if (!ctx.holdings) return skip("Waiting on your current holdings before Vera can keep the mix.");
  const uncapped = evaluateMixKeeper(ctx.holdings, rule.stockPct, MIX_TOLERANCE_PCT, UNCAPPED_BUDGET);
  return ok(rule, buyOnly(uncapped, ctx.budgetUsd));
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
      return planEarnings(chain, rule, ctx);
  }
}

/**
 * Buy a stock a few days before it reports results. The date comes from lib/server/earnings.ts
 * (Binance has none); no announced date means no trade, never a guess. The "sell after" half
 * can't run yet: StaxExecutor only buys, so after earnings Vera holds and says so. A position
 * already held means this window's buy has happened, so the rule doesn't buy again every day.
 */
async function planEarnings(chain: StaxChain, rule: Extract<Rule, { type: "earnings" }>, ctx: RuleRunContext): Promise<RulePlanResult> {
  const info = (await getNextEarnings([rule.symbol]))[rule.symbol];
  if (!info || info.nextMs === null) return skip(`${rule.symbol} hasn't announced its next results date yet.`);
  const action = evaluateEarnings(ctx.nowMs, info.nextMs, rule.buyDaysBefore, rule.sellDaysAfter);
  if (action === "hold") return ok(rule, []);
  if (action === "sell") return skip(`Vera can't sell yet, so your ${rule.symbol} stays put after its results.`);
  if (ctx.holdings?.some((h) => h.symbol === rule.symbol && h.usdValue > 0)) return ok(rule, []);
  if (!assetBySymbol(chain, rule.symbol)) return skip(`${rule.symbol} isn't listed on ${chain.name} right now.`);
  const usd = round2(ctx.budgetUsd);
  if (usd <= 0) return ok(rule, []);
  return ok(rule, [{ symbol: rule.symbol, action: "buy", usd, reason: `Buying ${rule.symbol} ${rule.buyDaysBefore} days before its results.` }]);
}

export type { RuleType };
