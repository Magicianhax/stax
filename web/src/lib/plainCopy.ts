// plainCopy — the sentences a web2-naive investor reads instead of trader jargon, kept as pure,
// tested functions so wording lives in one place instead of being retyped (and re-drifted) in
// every screen that needs it. Design critique P0 #3/#4, P1 #8, and the dry-run render decision.
import { formatOpensLocal } from "./marketHours";
import type { MarketState } from "./rwa";
import type { DryRun } from "./dryRun";

/** Below this, the two prices round to the same cent often enough that a signed number just
 *  reads as noise — "same" is the honest word. Matches lib/rwa.ts's own docs on `gapPct`. */
const SAME_PRICE_THRESHOLD_PCT = 0.05;

/** "0.40% more than the real share" / "Same as the real share" — no price, for a compact row
 *  (VenuePicker) that already shows the token's price next to it. */
export function gapWords(gapPct: number | null): string {
  if (gapPct === null) return "";
  const abs = Math.abs(gapPct);
  if (abs < SAME_PRICE_THRESHOLD_PCT) return "Same as the real share";
  return `${abs.toFixed(2)}% ${gapPct > 0 ? "more" : "less"} than the real share`;
}

/** "You pay 0.40% more than the real share ($180.70)" — the full sentence for the chosen
 *  issuer's headline (PriceGap), naming the reference price a "+0.40% vs NVDA" figure never did. */
export function gapSentence(gapPct: number | null, referencePrice: number): string {
  if (gapPct === null) return "";
  const abs = Math.abs(gapPct);
  if (abs < SAME_PRICE_THRESHOLD_PCT) return "Same as the real share";
  const usd = referencePrice.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `You pay ${abs.toFixed(2)}% ${gapPct > 0 ? "more" : "less"} than the real share (${usd})`;
}

/**
 * The one plain-words label for a BSC venue's trading state — shared by MarketStatusBadge, the
 * Trade screen's closed line and Asset detail's refusal reason, so "Pre-market" / "Overnight" /
 * "Unavailable" never leak to the screen again (design critique P1 #8). `buyable` decides the
 * headline word, not the session name: Ondo fills orders pre-market and overnight, so a session
 * label alone can't say whether a tap would go through right now.
 */
export function stateLabel(params: {
  state: MarketState;
  buyable: boolean;
  /** Epoch ms of the next regular-session open, or null when none is known (a plain pause). */
  nextOpenMs: number | null;
  /** "bStock" / "Ondo" — named on a pause so the reason isn't an anonymous "the market". */
  platformLabel?: string;
  nowMs?: number;
}): string {
  const { state, buyable, nextOpenMs, platformLabel, nowMs = Date.now() } = params;
  if (buyable) return "Open now";
  if (state === "unsupported") return "Can't be bought here";
  if (state === "paused" && nextOpenMs === null) {
    return platformLabel ? `Paused by ${platformLabel} for now` : "Paused for now";
  }
  if (nextOpenMs !== null) return `Closed · ${formatOpensLocal(nextOpenMs, nowMs)}`;
  return "Closed";
}

export type DryRunLine = { kind: "none" } | { kind: "quiet"; text: string } | { kind: "blocking"; text: string };

/**
 * What Trade/Plan should render for a Binance Transaction API dry run (Task: wave-5 "dryrun"
 * stream attaches `DryRun` to the quote). Never claims a check that didn't run: "skipped" and no
 * dry run at all both render nothing, only "passed" earns the quiet confirmation line, and
 * "failed" surfaces Binance's reason (or a safe fallback) and tells the caller to block confirm.
 */
export function dryRunLine(dryRun: DryRun | undefined, qty: string, symbol: string): DryRunLine {
  if (!dryRun || dryRun.status === "skipped") return { kind: "none" };
  if (dryRun.status === "passed") {
    return { kind: "quiet", text: `Checked with Binance · you'll get about ${qty} ${symbol}` };
  }
  return { kind: "blocking", text: dryRun.reason ?? "Binance couldn't confirm this trade would go through." };
}
