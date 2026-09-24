// PlanScreen's per-leg reading of a Vera plan's Binance Transaction API dry runs
// (InvestPlanResult.dryRuns — one entry per leg, same order as allocation.allocations; see
// lib/invest-types.ts's own doc comment on `dryRuns`). Deliberately separate from
// lib/plainCopy.ts's `dryRunLine` (owned by another wave-5a stream), which is Trade's own quiet
// inline check and intentionally renders nothing for "skipped" so a routine buy doesn't read like
// something unusual happened. PlanScreen is the one trust moment before a hold-to-invest moves
// real money across every leg at once, so a leg Binance never got the chance to check (its first
// trade of that token) says so in plain words here, instead of staying silent — still never
// claiming a check that didn't run, exactly the same rule, just a different, more visible answer
// for the same "skipped" case.
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
  /** True when any leg actually failed its dry run — Invest must stay disabled. */
  blocked: boolean;
}

const NOT_CHECKED_TEXT = "Not checked yet — first trade of this token";
const FAILED_FALLBACK_TEXT = "Binance checked this trade and it wouldn't go through right now.";

/**
 * Empty (`legs: []`, `blocked: false`) when there is nothing to show at all — no `dryRuns` array,
 * or an empty one (the executor path, or a plan built before this data existed). PlanScreen then
 * renders exactly as it did before this stream touched it.
 */
export function planDryRunView(
  allocations: readonly { symbol: string }[],
  dryRuns: readonly DryRun[] | undefined,
  decimalsFor: (symbol: string) => number,
): PlanDryRunView {
  if (!dryRuns || dryRuns.length === 0) return { legs: [], blocked: false };

  const legs = allocations.map((a, i): PlanLegCheck => {
    const dr = dryRuns[i];
    if (!dr || dr.status === "skipped") {
      return { symbol: a.symbol, status: "not_checked", text: NOT_CHECKED_TEXT };
    }
    if (dr.status === "failed") {
      return { symbol: a.symbol, status: "failed", text: dr.reason ?? FAILED_FALLBACK_TEXT };
    }
    const qty = dr.receiveRaw !== undefined ? tokenQty(BigInt(dr.receiveRaw), decimalsFor(a.symbol)) : undefined;
    return {
      symbol: a.symbol,
      status: "checked",
      text: qty ? `Checked with Binance · you'll get about ${qty} ${a.symbol}` : "Checked with Binance",
    };
  });

  return { legs, blocked: legs.some((l) => l.status === "failed") };
}
