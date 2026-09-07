// Pure helpers for the gift surfaces. No React, no "use client" — the public
// `/gift/[id]` server page imports from here too, so everything must render the
// same string on the server and in the browser.
//
// Dates arrive from the API as ISO strings and are formatted in UTC on purpose:
// an unlock day is a calendar date the giver picked, and formatting it in the
// viewer's zone would make the server and client disagree, and could move the
// day across a timezone boundary.
//
// Email masking, validation and the countdown wording that the API also uses
// live in `@/lib/gifts` (gift-chain owns them); only what is UI-only is here.
import { absoluteSiteUrl } from "@/lib/urls";
import type { GiftItem, GiftSplitLeg } from "./types";

const DAY = 86_400_000;

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Sep 7, 2031" — the day a gift opens. Takes the API's ISO string. */
export function unlockDate(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? DATE.format(new Date(ms)) : "—";
}

/** The value a native `<input type="date">` wants: "2031-09-07", in UTC. */
export function toDateInput(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

/** Read a native date input back to unix seconds at midday UTC (never drifts a day). */
export function fromDateInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** The same calendar day, `n` years on. */
export function addYears(unixSec: number, n: number): number {
  const d = new Date(unixSec * 1000);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return Math.floor(d.getTime() / 1000);
}

/** Midday UTC today — the anchor every preset counts from. */
export function todayAnchor(nowMs: number = Date.now()): number {
  return Math.floor(Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate(), 12) / 1000);
}

/**
 * How long until it opens, without the verb: "Ready now", "Tomorrow",
 * "in 12 days", "in 7 months", "in 4 years". `@/lib/gifts` has the sentence
 * form ("opens in 7 months"); rows need the bare phrase so it can sit after a
 * status pill. Reads the clock, so client-side only — the public page shows the
 * date instead.
 */
export function untilLabel(iso: string, nowMs: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const ms = at - nowMs;
  if (ms <= 0) return "Ready now";
  const days = Math.ceil(ms / DAY);
  if (days <= 1) return "Tomorrow";
  if (days < 31) return `in ${days} days`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `in ${months} ${months === 1 ? "month" : "months"}`;
  return `in ${Math.round(days / 365.25)} years`;
}

/** Same idea, from unix seconds — the give flow works in seconds until it sends. */
export function untilLabelFromSeconds(unixSec: number, nowMs: number = Date.now()): string {
  return untilLabel(new Date(unixSec * 1000).toISOString(), nowMs);
}

/** "Sep 7, 2031" from unix seconds, for the unanswered give flow. */
export function unlockDateFromSeconds(unixSec: number): string {
  return DATE.format(new Date(unixSec * 1000));
}

/** True once the unlock day has arrived. */
export function isUnlocked(iso: string, nowMs: number = Date.now()): boolean {
  const at = Date.parse(iso);
  return Number.isFinite(at) && at <= nowMs;
}

/**
 * The dollars behind each holding, weights applied to the amount. The heaviest
 * holding absorbs the rounding so the legs always add back to the total.
 */
export function splitOf(items: GiftItem[], amountUsd: number): GiftSplitLeg[] {
  if (items.length === 0) return [];
  const order = [...items].sort((a, b) => b.weightPct - a.weightPct);
  const legs = order.map((i) => ({ ...i, amountUsd: Math.round(((amountUsd * i.weightPct) / 100) * 100) / 100 }));
  const drift = Math.round((amountUsd - legs.reduce((s, l) => s + l.amountUsd, 0)) * 100) / 100;
  legs[0] = { ...legs[0], amountUsd: Math.round((legs[0].amountUsd + drift) * 100) / 100 };
  return legs;
}

/**
 * The link the giver shares. `GiftSummary.shareUrl` is the authority and the
 * server builds the same string; this exists only for the demo, which has no
 * server, and as a fallback so a copy button is never dead.
 */
export function giftShareUrl(id: string): string {
  return absoluteSiteUrl(`/gift/${id}`);
}
