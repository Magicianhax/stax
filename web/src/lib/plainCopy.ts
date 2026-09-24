// plainCopy — the sentences a web2-naive investor reads instead of trader jargon, kept as pure,
// tested functions so wording lives in one place instead of being retyped (and re-drifted) in
// every screen that needs it. Design critique P0 #3/#4, P1 #8, and the dry-run render decision.
import { formatOpensLocal } from "./marketHours";
import type { MarketState } from "./rwa";
import type { RwaPlatform } from "./chains";
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
  // A pause is a pause whatever `nextOpenMs` says: `rwaCatalog.ts`'s `buildVenue` always fills it
  // in for a non-buyable venue (bStock's own calendar fallback, or Ondo's `nextOpenTime`), so a
  // real paused row never carries `null` here — checking for it meant a mid-session pause read
  // as "Closed · opens <tomorrow's regular open>", a reopen time nobody promised (reviewer
  // follow-up on design critique P1 #8 / P2 #14).
  if (state === "paused") {
    return platformLabel ? `Paused by ${platformLabel} for now` : "Paused for now";
  }
  if (nextOpenMs !== null) return `Closed · ${formatOpensLocal(nextOpenMs, nowMs)}`;
  return "Closed";
}

/**
 * The "why two rows" line under VenuePicker's card (design critique P0 #4). Only earns its place
 * when there actually are two venues to choose between — AMZN has no twin, and a ticker whose
 * twin `/tokens` doesn't list (AAPL/AAPLB) renders one row too, and both used to show this
 * explainer promising a second row that never renders. Also never claims Stax "picks the one
 * that's open" when neither venue actually is.
 */
export function venuePickerExplainer(venueCount: number, bestVenue: RwaPlatform | null): string {
  if (venueCount <= 1) return "";
  if (bestVenue === null) {
    return "Two companies make a token for this share, but neither is open right now. Tap to see the other one's price.";
  }
  return "Two companies make a token for this share. Stax picks the one that's open, with the price closest to the real share. Tap to choose the other.";
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
