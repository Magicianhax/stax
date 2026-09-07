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
import type { GiftItem } from "./types";

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

/** For a `datetime-local` input: the same instant, in the reader's own zone. */
export function toDateTimeInput(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Read one back. Parsed as local time, which is what the field showed. */
export function fromDateTimeInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
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

/**
 * The earliest instant a gift may open: far enough ahead that the invest and
 * park transactions land first. A clock read, kept here beside the other date
 * helpers so screens never call `Date.now` during render.
 */
export function earliestUnlock(minutes: number, nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) + minutes * 60;
}

/** Midday UTC today — the anchor every preset counts from. */
export function todayAnchor(nowMs: number = Date.now()): number {
  return Math.floor(Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate(), 12) / 1000);
}

// Formatters with no `timeZone`, so they print in whatever zone the reader is in.
// Client-side only, for the reason `unlockLocal` explains.
const LOCAL_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const LOCAL_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const LOCAL_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** Calendar days between two instants in the reader's zone, so "tomorrow" means their tomorrow. */
function localDaysApart(fromMs: number, toMs: number): number {
  const midnight = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((midnight(toMs) - midnight(fromMs)) / DAY);
}

/**
 * The unlock on the reader's own clock: "Sep 8, 2026", or "Sep 8 at 3:30 am" when
 * it lands within three days and the hour is the part they need.
 *
 * `unlockDate` formats in UTC on purpose, because the public share page renders on
 * the server and in the browser and the two must agree. Inside the app that is the
 * wrong choice: a gift opening at 22:00 UTC opens on the ninth for anyone east of
 * London, and printing "Sep 8" tells them the wrong day.
 */
export function unlockLocal(iso: string, nowMs: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const d = new Date(at);
  const soon = at > nowMs && at - nowMs < 3 * DAY;
  return soon ? `${LOCAL_DAY.format(d)} at ${LOCAL_TIME.format(d)}` : LOCAL_DATE.format(d);
}

/**
 * The same, from unix seconds: the give flow works in seconds until it sends.
 */
export function unlockWhenFromSeconds(unixSec: number, nowMs: number = Date.now()): string {
  return unlockLocal(new Date(unixSec * 1000).toISOString(), nowMs);
}

/** What is left on the clock. `done` once the gift is open. */
export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

/** The remaining time, broken into the parts a countdown shows. */
export function countdownTo(iso: string, nowMs: number = Date.now()): Countdown {
  const at = Date.parse(iso);
  let left = Number.isFinite(at) ? Math.floor((at - nowMs) / 1000) : 0;
  if (left <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  const days = Math.floor(left / 86_400);
  left -= days * 86_400;
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  return { days, hours, minutes, seconds: left - minutes * 60, done: false };
}

/**
 * How long until it opens, without the verb: "Ready now", "in 40 min",
 * "in 5 hours", "Tomorrow", "in 12 days", "in 7 months", "in 4 years".
 * `@/lib/gifts` has the sentence form ("opens in 7 months"); rows need the bare
 * phrase so it can sit after a status pill. Reads the clock, so client-side only —
 * the public page shows the date instead.
 *
 * Days are counted as calendar days in the reader's zone rather than by rounding
 * the gap up: a gift two hours away is not "Tomorrow", and one at nine tonight is
 * not "Tomorrow" either.
 */
export function untilLabel(iso: string, nowMs: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const ms = at - nowMs;
  if (ms <= 0) return "Ready now";
  if (ms < 3_600_000) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  const days = localDaysApart(nowMs, at);
  if (days === 0) {
    const hours = Math.round(ms / 3_600_000);
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (days === 1) return "Tomorrow";
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
 * The dollars behind each holding. Weights are normalised over the items given,
 * rather than assumed to sum to 100, so this is also correct for a subset of a
 * basket. The heaviest holding absorbs the rounding, so the legs always add back
 * to the total exactly.
 */
export function splitOf<T extends GiftItem>(items: T[], amountUsd: number): (T & { amountUsd: number })[] {
  if (items.length === 0) return [];
  const total = items.reduce((sum, i) => sum + Math.max(0, i.weightPct), 0) || 1;
  const order = [...items].sort((a, b) => b.weightPct - a.weightPct);
  const legs = order.map((i) => ({ ...i, amountUsd: Math.round(((amountUsd * i.weightPct) / total) * 100) / 100 }));
  const drift = Math.round((amountUsd - legs.reduce((s, l) => s + l.amountUsd, 0)) * 100) / 100;
  legs[0] = { ...legs[0], amountUsd: Math.round((legs[0].amountUsd + drift) * 100) / 100 };
  return legs;
}

/**
 * The review card's rows for a gift being composed.
 *
 * The fee is skimmed on the invest leg ONLY, so it cannot be spread evenly over
 * every row: the safe slice is parked whole. Each group is split against its own
 * summary line, so a row can never disagree with the total printed underneath it.
 * Both totals are passed in already rounded, so the caller owns which line
 * absorbs the rounding remainder and this cannot reintroduce drift.
 */
export function reviewRows(
  holdings: (GiftItem & { heldAsCash?: boolean })[],
  /** The "Invested for them" line, already net of the fee and already absorbing the cent. */
  investedUsd: number,
  /** The "Set aside as dollars" line. */
  cashUsd: number,
): (GiftItem & { heldAsCash?: boolean; amountUsd: number })[] {
  const cash = splitOf(holdings.filter((h) => h.heldAsCash), cashUsd);
  const bought = splitOf(holdings.filter((h) => !h.heldAsCash), investedUsd);
  return [...cash, ...bought].sort((a, b) => b.weightPct - a.weightPct);
}

/**
 * The link the giver shares. `GiftSummary.shareUrl` is the authority and the
 * server builds the same string; this exists only for the demo, which has no
 * server, and as a fallback so a copy button is never dead.
 */
export function giftShareUrl(id: string): string {
  return absoluteSiteUrl(`/gift/${id}`);
}

/** The four ways to answer "when does it open", in the order the chips show them. */
export type UnlockPreset = "days" | "1y" | "5y" | "18th" | "custom";

/**
 * The instant the chosen preset works out to, in unix seconds, or null when the
 * answer is not usable yet. Days count from `now`, not from midnight, so "in 1
 * day" is this time tomorrow rather than a moment that may already have passed.
 */
export function resolveUnlock(
  preset: UnlockPreset | null,
  today: number,
  dob: string,
  custom: string,
  days: string,
  now: number,
): number | null {
  if (preset === "days") {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1) return null;
    return now + n * 86_400;
  }
  if (preset === "1y") return addYears(today, 1);
  if (preset === "5y") return addYears(today, 5);
  if (preset === "18th") {
    const born = fromDateInput(dob);
    return born ? addYears(born, 18) : null;
  }
  if (preset === "custom") return fromDateTimeInput(custom);
  return null;
}
