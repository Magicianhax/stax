// Plain-English rules Vera runs for you on BSC, via Autopilot. Client-safe and pure: no chain
// client, no fetch, no "server-only" import — every evaluator takes plain numbers the caller
// (lib/server/rulesEngine.ts on the server, or AutopilotScreen for a live preview) already has
// in hand, so the actual decision logic is a plain Node/browser test, not an integration test.
//
// Six rule types (brief ideas 1 and 5, plus the "act on it" half of idea 4):
//   1. schedule_buy   — today's Autopilot DCA. No new params; unchanged behaviour.
//   2. rebalance      — keep a basket close to its target weights.
//   3. buy_discount   — buy a stock when it's cheaper than the real share by at least N%.
//   4. safety_switch  — move money into steadier holdings after a sharp one-day market drop.
//   5. mix_keeper     — keep roughly N% stocks / (100-N)% crypto.
//   6. earnings       — buy before a stock's earnings, sell after (evaluator only: another
//                       stream supplies `nextEarningsMs`; this file only judges what to do
//                       once it has that date).
//
// Persistence note: adding a `rule` column would need a migration, and the Global Constraint
// for this effort allows exactly one (already spent on Task 3). So a rule rides inside the
// existing `AutopilotConfig.goal` text column, the same way autopilotStore.ts already folds a
// basket's id/name into the `reason` column for a run log row — `encodeRuleGoal`/`decodeRuleGoal`
// below are that same trick for the config, not a new pattern.
import type { RwaPlatform } from "./chains";

export type RuleType = "schedule_buy" | "rebalance" | "buy_discount" | "safety_switch" | "mix_keeper" | "earnings";

export interface ScheduleBuyRule {
  type: "schedule_buy";
}
export interface RebalanceRule {
  type: "rebalance";
  /** How far a holding may drift from its target weight, in percentage points, before Vera fixes it. */
  driftPct: number;
}
export interface BuyDiscountRule {
  type: "buy_discount";
  symbol: string;
  /** How far below the real share price counts as "cheap enough to buy", in percent. */
  discountPct: number;
}
export interface SafetySwitchRule {
  type: "safety_switch";
  /** One-day drop in the market that arms the switch, in percent. */
  dropPct: number;
  /** Share of the at-risk holdings moved into steadier ones once armed, in percent. */
  movePct: number;
}
export interface MixKeeperRule {
  type: "mix_keeper";
  /** Target share of the stocks+crypto mix held in stocks, in percent (the rest is crypto). */
  stockPct: number;
}
export interface EarningsRule {
  type: "earnings";
  symbol: string;
  /** Buy this many days before the next earnings date. */
  buyDaysBefore: number;
  /** Sell this many days after the next earnings date. */
  sellDaysAfter: number;
}

export type Rule = ScheduleBuyRule | RebalanceRule | BuyDiscountRule | SafetySwitchRule | MixKeeperRule | EarningsRule;

// ── Bounded defaults ─────────────────────────────────────────────────────────
//
// Every numeric knob a user (or Vera, parsing a goal) can turn is clamped here. A rule that
// asked for something wild — "move 500% into safety" — comes back clamped to the ceiling, not
// refused outright: the same "sensible bounded default" reasoning autopilot.ts already applies
// to riskCeilingBps.

interface Bound {
  min: number;
  max: number;
  default: number;
}

const BOUNDS = {
  driftPct: { min: 3, max: 30, default: 10 } as Bound,
  discountPct: { min: 1, max: 15, default: 2 } as Bound,
  dropPct: { min: 2, max: 20, default: 5 } as Bound,
  movePct: { min: 10, max: 100, default: 50 } as Bound,
  stockPct: { min: 20, max: 95, default: 80 } as Bound,
  buyDaysBefore: { min: 1, max: 10, default: 3 } as Bound,
  sellDaysAfter: { min: 1, max: 10, default: 1 } as Bound,
};

export const RULE_BOUNDS = BOUNDS;

export const RULE_DEFAULTS = {
  rebalance: { driftPct: BOUNDS.driftPct.default },
  buy_discount: { discountPct: BOUNDS.discountPct.default },
  safety_switch: { dropPct: BOUNDS.dropPct.default, movePct: BOUNDS.movePct.default },
  mix_keeper: { stockPct: BOUNDS.stockPct.default },
  earnings: { buyDaysBefore: BOUNDS.buyDaysBefore.default, sellDaysAfter: BOUNDS.sellDaysAfter.default },
};

function clamp(key: keyof typeof BOUNDS, n: number | undefined): number {
  const b = BOUNDS[key];
  if (typeof n !== "number" || !Number.isFinite(n)) return b.default;
  return Math.max(b.min, Math.min(b.max, Math.round(n)));
}

/**
 * Bounded defaults applied to a raw rule — the one place every rule (freshly parsed by Vera,
 * decoded off a stored config, or typed by hand in a test) is made safe. Never throws; a
 * missing/garbage number becomes the type's default rather than a refusal, because a slider the
 * user can already only push to its own min/max shouldn't refuse either. Symbol fields are left
 * untouched here — checking a symbol is actually tradeable needs the live catalog, which is
 * lib/server/rulesParser.ts's job, not this pure file's.
 */
export function sanitizeRule(rule: Rule): Rule {
  switch (rule.type) {
    case "schedule_buy":
      return { type: "schedule_buy" };
    case "rebalance":
      return { type: "rebalance", driftPct: clamp("driftPct", rule.driftPct) };
    case "buy_discount":
      return { type: "buy_discount", symbol: rule.symbol, discountPct: clamp("discountPct", rule.discountPct) };
    case "safety_switch":
      return { type: "safety_switch", dropPct: clamp("dropPct", rule.dropPct), movePct: clamp("movePct", rule.movePct) };
    case "mix_keeper":
      return { type: "mix_keeper", stockPct: clamp("stockPct", rule.stockPct) };
    case "earnings":
      return {
        type: "earnings",
        symbol: rule.symbol,
        buyDaysBefore: clamp("buyDaysBefore", rule.buyDaysBefore),
        sellDaysAfter: clamp("sellDaysAfter", rule.sellDaysAfter),
      };
  }
}

/** Runtime shape check for a value decoded off a text column — never trust it unseen. */
export function isValidRule(v: unknown): v is Rule {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const num = (k: string) => typeof r[k] === "number";
  const str = (k: string) => typeof r[k] === "string" && r[k] !== "";
  switch (r.type) {
    case "schedule_buy":
      return true;
    case "rebalance":
      return num("driftPct");
    case "buy_discount":
      return str("symbol") && num("discountPct");
    case "safety_switch":
      return num("dropPct") && num("movePct");
    case "mix_keeper":
      return num("stockPct");
    case "earnings":
      return str("symbol") && num("buyDaysBefore") && num("sellDaysAfter");
    default:
      return false;
  }
}

// ── UI cards (AutopilotScreen, Wave 5b "rules" stream, item D) ──────────────
//
// Five cards, not six: earnings needs a data source another stream supplies
// (`nextEarningsMs`), so it isn't pickable from the UI yet — wire it in once that lands
// (wiringNeeded).

export interface RuleCard {
  type: Exclude<RuleType, "earnings">;
  title: string;
  sentence: string;
  example: string;
}

/**
 * Rule types rulesEngine.ts cannot act on for real yet. Empty now: rebalance, safety_switch and
 * mix_keeper used to sit here because they need a live per-asset holdings read that wasn't wired
 * up (a plain "waiting on your holdings" skip, always) — `lib/server/bscHoldings.ts` now supplies
 * that read (see rulesEngine.ts's file header for how they act on it: buy-only, since the BSC
 * executor can't sell). Kept as the one gate the picker, `POST /api/autopilot` and Vera's parser
 * (rulesParser.ts) all check, so a future rule type that genuinely can't act yet has somewhere to
 * go without three call sites drifting out of sync (review finding #5).
 */
export const RULES_NEEDING_HOLDINGS: readonly RuleType[] = [];

/**
 * Rule types whose plan depends on `RuleRunContext.holdings` — the caller that builds that
 * context (`autopilotPlan.ts`) reads this to know which rules are worth fetching a live BSC
 * balance read for at all (buy_discount and earnings ignore holdings entirely; fetching for them
 * would just be a wasted Binance/RPC round trip every run).
 */
export const HOLDINGS_RULE_TYPES: readonly RuleType[] = ["rebalance", "safety_switch", "mix_keeper"];

export const RULE_COMING_SOON_REASON =
  "Coming soon: this rule needs to read your current BNB Chain holdings, and that isn't connected yet.";

export const RULE_CARDS: RuleCard[] = [
  {
    type: "schedule_buy",
    title: "Buy on a schedule",
    sentence: "Vera puts the same amount in for you every period, automatically.",
    example: "$25 every week into your plan.",
  },
  {
    type: "rebalance",
    title: "Keep it balanced",
    sentence: "Vera keeps your basket close to its target mix, trimming what's grown too big and topping up what's fallen behind.",
    example: "Fix anything that drifts more than 10% from target.",
  },
  {
    type: "buy_discount",
    title: "Buy the discount",
    sentence: "Vera buys a stock for you when it's trading below the real share price.",
    example: "Buy NVDA when it's at least 2% cheaper than the real share.",
  },
  {
    type: "safety_switch",
    title: "Safety switch",
    sentence: "If the market drops sharply in a day, Vera moves some of your money into steadier holdings.",
    example: "If the market drops 5% in a day, move 50% into steadier holdings.",
  },
  {
    type: "mix_keeper",
    title: "Keep a mix",
    sentence: "Vera keeps a steady mix of stocks and crypto for you, no matter how each one moves.",
    example: "Keep about 80% stocks and 20% crypto.",
  },
];

// ── goal-column encoding ─────────────────────────────────────────────────────

const RULE_GOAL_PREFIX = "stax:rule:v1:";
const RULE_GOAL_SEP = "::";

/** Folds a rule + its display goal into one string for `AutopilotConfig.goal` (see file header). */
export function encodeRuleGoal(rule: Rule, displayGoal: string): string {
  return `${RULE_GOAL_PREFIX}${JSON.stringify(sanitizeRule(rule))}${RULE_GOAL_SEP}${displayGoal}`;
}

/**
 * True when `goal` already carries (or fakes) the encoding only `encodeRuleGoal` should ever
 * produce. `/api/autopilot`'s POST is the one place that calls `encodeRuleGoal`, from its own
 * validated `body.rule` — a plain `goal` field that already looks like this must be refused
 * there rather than accepted and later decoded as an unvalidated rule (review finding #3).
 */
export function looksLikeEncodedRuleGoal(goal: string): boolean {
  return goal.startsWith(RULE_GOAL_PREFIX);
}

/**
 * Reads a rule back out of a config's `goal`. Null for a plain goal (no rule was ever saved —
 * every existing Base/Mantle autopilot) or a corrupted encoding; never throws. Re-sanitizes on
 * the way out, so a value that reached the column some other way (a hand-edited row, a future
 * bug) can't hand the executor an out-of-bounds number.
 */
export function decodeRuleGoal(goal: string): { rule: Rule; displayGoal: string } | null {
  if (!goal.startsWith(RULE_GOAL_PREFIX)) return null;
  const rest = goal.slice(RULE_GOAL_PREFIX.length);
  const sep = rest.indexOf(RULE_GOAL_SEP);
  if (sep === -1) return null;
  try {
    const parsed: unknown = JSON.parse(rest.slice(0, sep));
    if (!isValidRule(parsed)) return null;
    return { rule: sanitizeRule(parsed), displayGoal: rest.slice(sep + RULE_GOAL_SEP.length) };
  } catch {
    return null;
  }
}

// ── evaluators ────────────────────────────────────────────────────────────────

/** One buy or sell Vera's plan calls for, in dollars. Execution still applies the $6 leg floor,
 *  the buyable-right-now gate and the per-period cap on top of this — see rulesEngine.ts. */
export interface RuleIntent {
  symbol: string;
  action: "buy" | "sell";
  usd: number;
  reason: string;
  /** BSC only: which issuer this buy actually prices against (review finding #2) — the executor
   *  resolves the on-chain address from this, and refuses rather than buy the wrong issuer's
   *  token when it can't. Undefined for a non-RWA symbol or an off-BSC rule. */
  platform?: RwaPlatform;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface HoldingWeight {
  symbol: string;
  usdValue: number;
}

/**
 * Rebalance: sells whatever has drifted more than `driftPct` above its target weight and buys
 * whatever has drifted the same amount below, funding the buys from the sells so the run is
 * roughly self-funding. A holding with no target at all is treated as 100% overweight (sell it
 * down to zero); a target with no current holding is 100% underweight. The total moved is capped
 * at `budgetUsd` (the period's contribution / per-period cap), scaling every leg down together
 * so the ratio between legs is preserved.
 */
export function evaluateRebalance(
  holdings: readonly HoldingWeight[],
  targets: readonly { symbol: string; weightPct: number }[],
  driftPct: number,
  budgetUsd: number,
): RuleIntent[] {
  const total = holdings.reduce((s, h) => s + h.usdValue, 0);
  if (total <= 0) return [];

  const targetPct = new Map(targets.map((t) => [t.symbol, t.weightPct]));
  const curVal = new Map(holdings.map((h) => [h.symbol, h.usdValue]));
  const symbols = new Set<string>([...curVal.keys(), ...targetPct.keys()]);

  const rows = [...symbols].map((symbol) => {
    const cur = curVal.get(symbol) ?? 0;
    const curPct = (cur / total) * 100;
    const tgtPct = targetPct.get(symbol) ?? 0;
    return { symbol, curPct, tgtPct, driftAmt: curPct - tgtPct };
  });

  const over = rows.filter((r) => r.driftAmt > driftPct);
  const under = rows.filter((r) => r.driftAmt < -driftPct);
  if (over.length === 0 && under.length === 0) return [];

  const rawSells = over.map((r) => ({ symbol: r.symbol, usd: (r.driftAmt / 100) * total, row: r }));
  const rawBuys = under.map((r) => ({ symbol: r.symbol, usd: (-r.driftAmt / 100) * total, row: r }));
  const sellTotal = rawSells.reduce((s, l) => s + l.usd, 0);
  const buyTotal = rawBuys.reduce((s, l) => s + l.usd, 0);
  // Sells fund buys 1:1 in this model (no outside cash), so the amount that actually moves is
  // capped by whichever side is smaller AND by the period's own budget.
  const moveTotal = Math.min(sellTotal, buyTotal, budgetUsd);
  if (moveTotal <= 0) return [];
  const sellScale = moveTotal / sellTotal;
  const buyScale = moveTotal / buyTotal;

  const sells: RuleIntent[] = rawSells.map((l) => ({
    symbol: l.symbol,
    action: "sell",
    usd: round2(l.usd * sellScale),
    reason: `${l.symbol} has drifted to ${l.row.curPct.toFixed(0)}% of the basket, above its ${l.row.tgtPct.toFixed(0)}% target.`,
  }));
  const buys: RuleIntent[] = rawBuys.map((l) => ({
    symbol: l.symbol,
    action: "buy",
    usd: round2(l.usd * buyScale),
    reason: `${l.symbol} has drifted to ${l.row.curPct.toFixed(0)}% of the basket, below its ${l.row.tgtPct.toFixed(0)}% target.`,
  }));
  return [...sells, ...buys];
}

/**
 * Buy the discount: fires only when the token is both buyable right now and priced at least
 * `discountPct` below the real share — a cheap price nobody can act on (market shut, issuer
 * paused) is not a buy signal, same reasoning as `classifySpread`'s discount call in spread.ts.
 */
export function evaluateBuyDiscount(
  venue: { symbol: string; buyable: boolean; gapPct: number | null; platform?: RwaPlatform },
  discountPct: number,
  amountUsd: number,
): RuleIntent[] {
  if (!venue.buyable || venue.gapPct === null || venue.gapPct > -discountPct) return [];
  return [
    {
      symbol: venue.symbol,
      action: "buy",
      usd: amountUsd,
      reason: `${venue.symbol} is trading ${Math.abs(venue.gapPct).toFixed(1)}% below the real share.`,
      platform: venue.platform,
    },
  ];
}

/**
 * Safety switch: once the market's one-day drop clears `dropPct`, sells a `movePct` share of
 * every holding that ISN'T already on the safer list, and spreads the proceeds evenly across
 * the safer list. Evenly, not weighted by what's already held there, so the move is predictable
 * and easy to explain in the receipt line — the safer list is short (SAFER_SYMBOLS) by design.
 * Does nothing with an empty safer list (nowhere to move the money) or a budget of $0.
 */
export function evaluateSafetySwitch(
  holdings: readonly HoldingWeight[],
  marketDropPct: number,
  dropThresholdPct: number,
  movePct: number,
  saferSymbols: readonly string[],
  budgetUsd: number,
): RuleIntent[] {
  if (marketDropPct < dropThresholdPct || saferSymbols.length === 0) return [];
  const safer = new Set(saferSymbols);
  const risky = holdings.filter((h) => !safer.has(h.symbol) && h.usdValue > 0);
  const riskyTotal = risky.reduce((s, h) => s + h.usdValue, 0);
  if (riskyTotal <= 0) return [];

  const wanted = riskyTotal * (movePct / 100);
  const moveTotal = Math.min(wanted, budgetUsd);
  if (moveTotal <= 0) return [];
  const scale = moveTotal / riskyTotal;

  const sells: RuleIntent[] = risky.map((h) => ({
    symbol: h.symbol,
    action: "sell",
    usd: round2(h.usdValue * scale),
    reason: `The market dropped ${marketDropPct.toFixed(1)}% today, so Vera is moving part of ${h.symbol} into steadier holdings.`,
  }));
  const perSafer = round2(moveTotal / saferSymbols.length);
  const buys: RuleIntent[] = saferSymbols.map((symbol) => ({
    symbol,
    action: "buy",
    usd: perSafer,
    reason: `${symbol} is on Vera's steadier list.`,
  }));
  return [...sells, ...buys];
}

export interface TieredHolding extends HoldingWeight {
  tier: "stock" | "crypto" | "safe";
}

/**
 * Mix keeper: keeps the stock-vs-crypto split near `targetStockPct`, ignoring "safe" tier
 * holdings entirely (they're neither side of this ratio). When the underweight side has nothing
 * held yet, the proceeds buy `fallbackStock`/`fallbackCrypto` instead of nothing.
 */
export function evaluateMixKeeper(
  holdings: readonly TieredHolding[],
  targetStockPct: number,
  tolerancePct: number,
  budgetUsd: number,
  fallback: { stock: string; crypto: string } = { stock: "SPY", crypto: "BTCB" },
): RuleIntent[] {
  const stock = holdings.filter((h) => h.tier === "stock");
  const crypto = holdings.filter((h) => h.tier === "crypto");
  const stockTotal = stock.reduce((s, h) => s + h.usdValue, 0);
  const cryptoTotal = crypto.reduce((s, h) => s + h.usdValue, 0);
  const total = stockTotal + cryptoTotal;
  if (total <= 0) return [];

  const currentStockPct = (stockTotal / total) * 100;
  const drift = currentStockPct - targetStockPct;
  if (Math.abs(drift) <= tolerancePct) return [];

  const moveWanted = (Math.abs(drift) / 100) * total;
  const overweight = drift > 0 ? stock : crypto;
  const overweightTotal = drift > 0 ? stockTotal : cryptoTotal;
  const moveTotal = Math.min(moveWanted, overweightTotal, budgetUsd);
  if (moveTotal <= 0) return [];
  const scale = moveTotal / overweightTotal;

  const sells: RuleIntent[] = overweight.map((h) => ({
    symbol: h.symbol,
    action: "sell",
    usd: round2(h.usdValue * scale),
    reason: `${drift > 0 ? "Stocks" : "Crypto"} grew to ${currentStockPct.toFixed(0)}% of the mix; the target is ${targetStockPct}%.`,
  }));
  const underSide = drift > 0 ? crypto : stock;
  const underweight = underSide.length > 0 ? underSide : [{ symbol: drift > 0 ? fallback.crypto : fallback.stock, usdValue: 0, tier: drift > 0 ? "crypto" : "stock" } as TieredHolding];
  const underTotal = underweight.reduce((s, h) => s + h.usdValue, 0);
  const buys: RuleIntent[] =
    underTotal > 0
      ? underweight.map((h) => ({
          symbol: h.symbol,
          action: "buy",
          usd: round2(moveTotal * (h.usdValue / underTotal)),
          reason: `Keeping the mix near ${targetStockPct}% stocks / ${100 - targetStockPct}% crypto.`,
        }))
      : [{ symbol: underweight[0].symbol, action: "buy", usd: round2(moveTotal), reason: `Keeping the mix near ${targetStockPct}% stocks / ${100 - targetStockPct}% crypto.` }];
  return [...sells, ...buys];
}

export type EarningsAction = "buy" | "sell" | "hold";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Earnings (evaluator only — `nextEarningsMs` is an input another stream's data source
 * supplies): "buy" inside the pre-earnings window, "sell" from the earnings date through the
 * end of the post-earnings window, "hold" otherwise. A caller that runs this once a day should
 * track whether it already acted on today's "buy"/"sell" itself; this function only judges the
 * date, it has no memory of what already happened (wiringNeeded).
 */
export function evaluateEarnings(nowMs: number, nextEarningsMs: number, buyDaysBefore: number, sellDaysAfter: number): EarningsAction {
  const buyFrom = nextEarningsMs - buyDaysBefore * DAY_MS;
  const sellUntil = nextEarningsMs + sellDaysAfter * DAY_MS;
  if (nowMs >= nextEarningsMs) return nowMs <= sellUntil ? "sell" : "hold";
  return nowMs >= buyFrom ? "buy" : "hold";
}

// ── receipts ──────────────────────────────────────────────────────────────────

const RULE_VERB: Record<RuleType, string> = {
  schedule_buy: "invested for you",
  rebalance: "rebalanced your",
  buy_discount: "bought the discount",
  safety_switch: "moved you into steadier holdings",
  mix_keeper: "kept your mix on target",
  earnings: "traded around earnings",
};

function legList(intents: readonly RuleIntent[]): string {
  return intents.map((i) => `${i.action === "sell" ? "sold" : "bought"} $${Math.round(i.usd)} of ${i.symbol}`).join(", ");
}

/**
 * "Vera rebalanced your AI chips basket: sold $12 of NVDA, bought $12 of AMD." — the one plain
 * receipt line every rule execution records (item C). `basketName` only applies to rules that
 * target a named basket (rebalance today; others read fine without one).
 */
export function formatRuleReceipt(rule: Rule, intents: readonly RuleIntent[], basketName?: string): string {
  if (intents.length === 0) {
    return basketName
      ? `Vera checked your ${basketName}: already on target, nothing to do.`
      : "Vera checked your plan: already on target, nothing to do.";
  }
  const legs = legList(intents);
  if (rule.type === "rebalance" && basketName) {
    return `Vera rebalanced your ${basketName}: ${legs}.`;
  }
  return `Vera ${RULE_VERB[rule.type]}: ${legs}.`;
}

/**
 * "Vera will buy NVDA when it's at least 3% cheaper than the real share." — the live one-sentence
 * preview AutopilotScreen shows while the user is still setting a rule's numbers up (item D),
 * before anything is saved. Every number is the actual one the user picked, never a placeholder.
 */
export function describeRule(rule: Rule): string {
  switch (rule.type) {
    case "schedule_buy":
      return "Vera will invest for you automatically, on your schedule.";
    case "rebalance":
      return `Vera will keep your basket close to target, fixing anything that drifts more than ${rule.driftPct}%.`;
    case "buy_discount":
      return `Vera will buy ${rule.symbol} when it's at least ${rule.discountPct}% cheaper than the real share.`;
    case "safety_switch":
      return `If the market drops ${rule.dropPct}% in a day, Vera will move ${rule.movePct}% of your at-risk holdings into steadier ones.`;
    case "mix_keeper":
      return `Vera will keep about ${rule.stockPct}% of your money in stocks and ${100 - rule.stockPct}% in crypto.`;
    case "earnings":
      return `Vera will buy ${rule.symbol} ${rule.buyDaysBefore} day${rule.buyDaysBefore === 1 ? "" : "s"} before its earnings and sell it ${rule.sellDaysAfter} day${rule.sellDaysAfter === 1 ? "" : "s"} after.`;
  }
}

// ── the "safer" list for the safety switch ───────────────────────────────────
//
// Broad, unleveraged US index funds only. TQQQ and SOXL are 2x/3x leveraged (the opposite of
// steadier); DRAM and EWY are a narrow sector bet and a single-country bet, each riskier than
// the diversified names they'd be "safety" for. Crypto never counts as safer, full stop — it
// isn't filtered out by name here because it's a different tier entirely (evaluateSafetySwitch
// is only ever called with stock-tier holdings; see rulesEngine.ts).
export const SAFER_SYMBOLS: readonly string[] = ["SPY", "QQQ"];
