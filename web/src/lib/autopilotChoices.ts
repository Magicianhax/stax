// The BSC Autopilot choice screen's words and small decisions, kept pure so they're testable in
// the node vitest env (AutopilotScreen itself can't be imported there).
//
// One question, "What should Vera do for you?", answered by one of six cards. Every sentence here
// is written for someone who has never invested: no "rebalance", "drift" or "tier". The rules
// themselves live in lib/rules.ts; this file only words them and previews them.
//
// `whatVeraWillDo` runs the rule through `sanitizeRule` first, so the preview shows the same
// clamped numbers `/api/autopilot` will save (it sanitizes too), never the raw keystrokes.
import type { Cadence } from "./autopilot";
import { investableAssets, type StaxChain } from "./chains";
import { displayFor } from "./displayAssets";
import { usd } from "./format";
import { RULE_BOUNDS, sanitizeRule, type Rule, type RuleType } from "./rules";

export interface AutopilotChoice {
  type: RuleType;
  title: string;
  sentence: string;
}

export const AUTOPILOT_CHOICES: readonly AutopilotChoice[] = [
  {
    type: "schedule_buy",
    title: "Invest on a schedule",
    sentence: "Vera puts in the same amount for you every week or month.",
  },
  {
    type: "buy_discount",
    title: "Buy the discount",
    sentence: "Vera buys a stock when it’s cheaper than the real share.",
  },
  {
    type: "earnings",
    title: "Buy before results",
    sentence: "Vera buys a stock a few days before the company reports results.",
  },
  {
    type: "rebalance",
    title: "Keep it balanced",
    sentence: "When one stock grows too big a share, Vera buys more of the others.",
  },
  {
    type: "mix_keeper",
    title: "Keep a mix",
    sentence: "Vera keeps your money split between stocks and crypto the way you like it.",
  },
  {
    type: "safety_switch",
    title: "Safety switch",
    sentence: "If the market drops sharply, Vera puts new money into steadier funds.",
  },
];

/** The card title — also the plan name the server saves for a rule. */
export function choiceTitle(type: RuleType): string {
  return AUTOPILOT_CHOICES.find((c) => c.type === type)?.title ?? "";
}

const BUY_ONLY = "Vera only buys for now. She adds new money to what’s short instead of selling.";

/** The one quiet honesty line for rules whose full version would sell (StaxExecutor can't). */
export function buyOnlyNote(type: RuleType): string | null {
  if (type === "rebalance" || type === "mix_keeper" || type === "safety_switch") return BUY_ONLY;
  if (type === "earnings") return "Vera only buys for now. She keeps the stock after results instead of selling.";
  return null;
}

/**
 * Earnings buys only when a run lands inside the few days before results (rulesEngine.ts), so a
 * weekly or monthly run could step right over the window. Checking daily can't; the engine skips
 * a repeat buy once the stock is held, so daily never means buying every day.
 */
export function cadenceForRule(type: RuleType, picked: Cadence): Cadence {
  return type === "earnings" ? "daily" : picked;
}

/** Same bounds and rounding as sanitizeRule, for snapping a number field on blur. */
export function clampRuleField(key: keyof typeof RULE_BOUNDS, n: number): number {
  const b = RULE_BOUNDS[key];
  if (!Number.isFinite(n)) return b.default;
  return Math.max(b.min, Math.min(b.max, Math.round(n)));
}

export interface StockChoice {
  symbol: string;
  name: string;
}

/**
 * The stocks a rule can name: tradeable stock-tier assets on this chain (the same list
 * `/api/autopilot` checks a buy_discount symbol against), one row per ticker, by company name.
 * `companiesOnly` drops funds (S&P 500, Nasdaq-100), which never report results.
 */
export function stockChoices(chain: StaxChain, opts: { companiesOnly?: boolean } = {}): StockChoice[] {
  const seen = new Set<string>();
  const out: StockChoice[] = [];
  for (const a of investableAssets(chain)) {
    if (a.tier !== "stock" || seen.has(a.symbol)) continue;
    const d = displayFor(a.symbol, a.name);
    if (opts.companiesOnly && d.kind === "fund") continue;
    seen.add(a.symbol);
    out.push({ symbol: a.symbol, name: d.name });
  }
  return out;
}

const EVERY: Record<Cadence, string> = { daily: "every day", weekly: "every week", biweekly: "every 2 weeks", monthly: "every month" };
const EACH: Record<Cadence, string> = { daily: "Each day", weekly: "Each week", biweekly: "Every 2 weeks", monthly: "Each month" };

const money = (n: number) => usd(n).replace(/\.00$/, "");
const nameOf = (symbol: string) => displayFor(symbol).name;

/** One plain sentence for "What Vera will do", built from the rule the server will save. */
export function whatVeraWillDo(input: {
  rule: Rule;
  amountUsd: number;
  cadence: Cadence;
  basketName?: string;
  goal?: string;
}): string {
  const rule = sanitizeRule(input.rule);
  const amt = money(input.amountUsd);
  const each = EACH[input.cadence];
  switch (rule.type) {
    case "schedule_buy": {
      const goal = input.goal?.trim();
      if (input.basketName) return `Vera will invest ${amt} ${EVERY[input.cadence]} in ${input.basketName}.`;
      if (goal) return `Vera will invest ${amt} ${EVERY[input.cadence]} toward “${goal}”.`;
      return `Vera will invest ${amt} ${EVERY[input.cadence]}.`;
    }
    case "buy_discount":
      return `${each}, if ${nameOf(rule.symbol)} is at least ${rule.discountPct}% cheaper than the real share, Vera buys ${amt} of it.`;
    case "earnings":
      return `Vera will buy ${amt} of ${nameOf(rule.symbol)} ${rule.buyDaysBefore} day${rule.buyDaysBefore === 1 ? "" : "s"} before it reports results.`;
    case "rebalance":
      return `${each}, Vera adds ${amt} to any stock in ${input.basketName ?? "your basket"} that falls more than ${rule.driftPct}% below its share.`;
    case "mix_keeper":
      return `${each}, Vera adds ${amt} to stocks or crypto, whichever is short of ${rule.stockPct}% stocks and ${100 - rule.stockPct}% crypto.`;
    case "safety_switch":
      return `${each}, if the market has dropped ${rule.dropPct}% or more in a day, Vera puts ${amt} into steadier funds.`;
  }
}
