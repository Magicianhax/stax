// PlanScreen's per-leg reading of a Vera plan's Binance Transaction API dry runs
// (InvestPlanResult.dryRuns — one entry per leg, each tagged with the leg's `symbol` and target
// `token` by /api/invest-plan). Deliberately separate from lib/plainCopy.ts's `dryRunLine`, which
// is Trade's own quiet inline check and intentionally renders nothing for "skipped" so a routine
// buy doesn't read like something unusual happened. PlanScreen is the one trust moment before a
// hold-to-invest moves real money across every leg at once, so a leg Binance hasn't checked yet
// says when it will be checked, instead of staying silent — still never claiming a check that
// didn't run.
//
// Legs are matched by symbol (or, for an entry without one, by the token address the allocation
// resolved), never by position: a nudge or a retry can reorder the plan, and a positional match
// once pinned one stock's failed check on a different stock (design critique P0 #1).
import type { DryRun } from "./dryRun";
import { tokenQty } from "./format";

export type PlanLegStatus = "checked" | "not_checked" | "failed";

export interface PlanLegCheck {
  symbol: string;
  status: PlanLegStatus;
  text: string;
}

export interface PlanDryRunView {
  legs: PlanLegCheck[];
  /** True when any leg failed its dry run. Hold stays enabled: the server re-checks every hold. */
  blocked: boolean;
  /** Symbols whose check failed, in plan order, for PlanScreen's one summary line. */
  failedSymbols: string[];
}

const NOT_CHECKED_TEXT = "Binance checks this when you invest";
const FAILED_TEXT = "Binance couldn't confirm this part just now";

function findDryRun(
  a: { symbol: string; address?: string },
  dryRuns: readonly DryRun[],
): DryRun | undefined {
  const bySymbol = dryRuns.find((d) => d.symbol === a.symbol);
  if (bySymbol) return bySymbol;
  const address = a.address?.toLowerCase();
  if (!address) return undefined;
  return dryRuns.find((d) => d.symbol === undefined && d.token?.toLowerCase() === address);
}

/**
 * Empty (`legs: []`, `blocked: false`) when there is nothing to show at all — no `dryRuns` array,
 * or an empty one (the executor path, or a plan not yet held). PlanScreen then renders exactly
 * as it does before the first hold.
 */
export function planDryRunView(
  allocations: readonly { symbol: string; address?: string }[],
  dryRuns: readonly DryRun[] | undefined,
  decimalsFor: (symbol: string) => number,
): PlanDryRunView {
  if (!dryRuns || dryRuns.length === 0) return { legs: [], blocked: false, failedSymbols: [] };

  const legs = allocations.map((a): PlanLegCheck => {
    const dr = findDryRun(a, dryRuns);
    if (!dr || dr.status === "skipped") {
      return { symbol: a.symbol, status: "not_checked", text: NOT_CHECKED_TEXT };
    }
    if (dr.status === "failed") {
      return { symbol: a.symbol, status: "failed", text: FAILED_TEXT };
    }
    const qty = dr.receiveRaw !== undefined ? tokenQty(BigInt(dr.receiveRaw), decimalsFor(a.symbol)) : undefined;
    return {
      symbol: a.symbol,
      status: "checked",
      text: qty ? `Checked with Binance · you'll get about ${qty} ${a.symbol}` : "Checked with Binance",
    };
  });

  const failedSymbols = legs.filter((l) => l.status === "failed").map((l) => l.symbol);
  return { legs, blocked: failedSymbols.length > 0, failedSymbols };
}

/**
 * The one line above Hold after a failed check: which part, and the two ways forward. A fixed
 * basket has no "Make it safer" chip, so it only offers the retry.
 */
export function planCheckFailedMessage(names: readonly string[], canNudge: boolean): string {
  if (names.length === 0) return "";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const part = names.length === 1 ? "part" : "parts";
  const next = canNudge ? "Hold to try again, or tap Make it safer." : "Hold to try again.";
  return `Binance couldn't confirm the ${list} ${part} just now. ${next}`;
}
