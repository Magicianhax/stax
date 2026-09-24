// US stock-market hours, pure and timezone-safe. Tokenized stocks trade on-chain
// 24/7, but their REFERENCE price (the Chainlink feed) only moves while the NYSE
// is open, so the UI tells the user when the next official price arrives.
//
//   marketStatus(now)      → { open, label, nextChange, reason? }
//   formatNextOpen(date)   → "opens Mon 9:30am ET"  (or "opens 9:30am ET" if today)
//   formatNextClose(date)  → "closes 4:00pm ET"
//   describeNextChange(s)  → picks the right one for a status
//
// Regular session: 9:30–16:00 America/New_York, Mon–Fri. Holidays follow the NYSE
// rules (nth-weekday holidays, Good Friday from Easter, fixed-date holidays
// observed Fri/Mon when they land on a weekend — except New Year's on a Saturday,
// which the NYSE does not observe). Early closes at 13:00: the day after
// Thanksgiving, Christmas Eve and July 3 when they fall on a trading day.
//
// Every wall-clock read goes through Intl.DateTimeFormat with timeZone, so DST is
// handled by the platform and never by hand-rolled offsets.
//
// Verification table (derived from the rules below):
//   2026: Jan 1 Thu · MLK Jan 19 · Presidents Feb 16 · Good Fri Apr 3 · Memorial May 25
//         Juneteenth Jun 19 Fri · Independence Jul 4 Sat → Fri Jul 3 · Labor Sep 7
//         Thanksgiving Nov 26 · Christmas Dec 25 Fri
//         early closes 13:00: Fri Nov 27, Thu Dec 24 (Jul 3 is the holiday → full close)
//   2027: Jan 1 Fri · MLK Jan 18 · Presidents Feb 15 · Good Fri Mar 26 · Memorial May 31
//         Juneteenth Jun 19 Sat → Fri Jun 18 · Independence Jul 4 Sun → Mon Jul 5 · Labor Sep 6
//         Thanksgiving Nov 25 · Christmas Dec 25 Sat → Fri Dec 24
//         early closes 13:00: Fri Nov 26 (Dec 24 is the holiday → full close; Jul 2 regular)
//   Status cases (ET):
//     Wed 2026-03-11 10:00 → Open, closes 4:00pm ET (DST started Mar 8: EDT)
//     Wed 2026-03-11 08:00 → Pre-market, opens 9:30am ET (reason after-hours)
//     Fri 2026-03-13 17:30 → After hours, opens Mon 9:30am ET (Mon Mar 16)
//     Sat 2026-03-14 12:00 → Closed (weekend), opens Mon 9:30am ET
//     Fri 2026-04-03 12:00 → Closed (holiday, Good Friday), opens Mon 9:30am ET
//     Fri 2026-11-27 13:30 → After hours (early close 1:00pm), opens Mon 9:30am ET
//     Thu 2026-12-24 12:00 → Open, closes 1:00pm ET
//     Fri 2027-12-24 12:00 → Closed (holiday, Christmas observed), opens Mon 9:30am ET

import type { MarketState } from "./rwa";

export type MarketLabel = "Open" | "Closed" | "Pre-market" | "After hours";
export type ClosedReason = "weekend" | "holiday" | "after-hours";

export interface MarketStatus {
  open: boolean;
  label: MarketLabel;
  /** Next open (when closed) or next close (when open). */
  nextChange: Date;
  reason?: ClosedReason;
}

const TZ = "America/New_York";
const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const EARLY_CLOSE_MIN = 13 * 60;

interface EtParts {
  y: number;
  m: number; // 1–12
  d: number;
  weekday: number; // 0 = Sun … 6 = Sat
  minutes: number; // minutes since local midnight
}

const PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  weekday: "short",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** ET wall-clock parts for an instant. */
function etParts(date: Date): EtParts {
  const p: Record<string, string> = {};
  for (const part of PARTS_FMT.formatToParts(date)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

/**
 * The instant at ET wall-clock (y, m, d, minutes). Guess the UTC time, read it
 * back through the formatter, and correct by the difference — two passes cover a
 * DST boundary between the guess and the answer.
 */
function etInstant(y: number, m: number, d: number, minutes: number): Date {
  let guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  for (let i = 0; i < 2; i++) {
    const p = etParts(new Date(guess));
    const got = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.minutes / 60), p.minutes % 60);
    const want = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
    if (got === want) break;
    guess += want - got;
  }
  return new Date(guess);
}

// ── Calendar helpers (pure date arithmetic on a proleptic calendar; no TZ) ──

function key(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** nth (1-based) `weekday` of month; `n = -1` for the last one. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = weekdayOf(y, m, 1);
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastWd = weekdayOf(y, m, last);
  return last - ((lastWd - weekday + 7) % 7);
}
/** Fixed-date holiday observed on the nearest weekday (Sat → Fri, Sun → Mon). */
function observed(y: number, m: number, d: number, satToFri = true): string | null {
  const wd = weekdayOf(y, m, d);
  if (wd === 6) {
    if (!satToFri) return null;
    const t = new Date(Date.UTC(y, m - 1, d - 1));
    return key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  if (wd === 0) {
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    return key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  return key(y, m, d);
}
/** Gregorian Easter Sunday (anonymous/Meeus algorithm) → [month, day]. */
function easter(y: number): [number, number] {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const holidayCache = new Map<number, { closed: Set<string>; early: Set<string> }>();

/** NYSE full-day closures and 13:00 early closes for a calendar year. */
function calendar(y: number): { closed: Set<string>; early: Set<string> } {
  const hit = holidayCache.get(y);
  if (hit) return hit;
  const closed = new Set<string>();
  const add = (k: string | null) => {
    if (k) closed.add(k);
  };
  add(observed(y, 1, 1, false)); // New Year's (Sat → not observed; Sun → Mon)
  add(key(y, 1, nthWeekday(y, 1, 1, 3))); // MLK — 3rd Monday Jan
  add(key(y, 2, nthWeekday(y, 2, 1, 3))); // Presidents — 3rd Monday Feb
  const [em, ed] = easter(y); // Good Friday — Easter − 2
  const gf = new Date(Date.UTC(y, em - 1, ed - 2));
  add(key(gf.getUTCFullYear(), gf.getUTCMonth() + 1, gf.getUTCDate()));
  add(key(y, 5, nthWeekday(y, 5, 1, -1))); // Memorial — last Monday May
  add(observed(y, 6, 19)); // Juneteenth
  add(observed(y, 7, 4)); // Independence Day
  add(key(y, 9, nthWeekday(y, 9, 1, 1))); // Labor — 1st Monday Sep
  const tg = nthWeekday(y, 11, 4, 4); // Thanksgiving — 4th Thursday Nov
  add(key(y, 11, tg));
  add(observed(y, 12, 25)); // Christmas
  // Next year's New Year's can be observed on Dec 31 of this year (Jan 1 on a
  // Sunday → Monday; Saturday → not observed), so nothing lands in December here.

  const early = new Set<string>();
  const earlyIf = (m: number, d: number) => {
    const k = key(y, m, d);
    const wd = weekdayOf(y, m, d);
    if (wd >= 1 && wd <= 5 && !closed.has(k)) early.add(k);
  };
  earlyIf(11, tg + 1); // day after Thanksgiving (always a Friday)
  earlyIf(12, 24); // Christmas Eve
  earlyIf(7, 3); // day before Independence Day

  const out = { closed, early };
  holidayCache.set(y, out);
  return out;
}

function isTradingDay(y: number, m: number, d: number): boolean {
  const wd = weekdayOf(y, m, d);
  if (wd === 0 || wd === 6) return false;
  return !calendar(y).closed.has(key(y, m, d));
}
function closeMinutes(y: number, m: number, d: number): number {
  return calendar(y).early.has(key(y, m, d)) ? EARLY_CLOSE_MIN : CLOSE_MIN;
}
/** Open instant of the first trading day strictly after (y, m, d). */
function nextOpenAfter(y: number, m: number, d: number): Date {
  let t = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 10; i++) {
    t = new Date(t.getTime() + 86_400_000);
    const yy = t.getUTCFullYear();
    const mm = t.getUTCMonth() + 1;
    const dd = t.getUTCDate();
    if (isTradingDay(yy, mm, dd)) return etInstant(yy, mm, dd, OPEN_MIN);
  }
  // Unreachable in practice (never more than 4 consecutive closed days). Fall back to
  // the day after the scan window, rolled over correctly across month/year ends.
  return etInstant(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), OPEN_MIN);
}

/** Current NYSE regular-session status for `now`. */
export function marketStatus(now: Date = new Date()): MarketStatus {
  const p = etParts(now);
  const weekend = p.weekday === 0 || p.weekday === 6;
  if (weekend || !isTradingDay(p.y, p.m, p.d)) {
    return {
      open: false,
      label: "Closed",
      reason: weekend ? "weekend" : "holiday",
      nextChange: nextOpenAfter(p.y, p.m, p.d),
    };
  }
  const close = closeMinutes(p.y, p.m, p.d);
  if (p.minutes < OPEN_MIN) {
    return { open: false, label: "Pre-market", reason: "after-hours", nextChange: etInstant(p.y, p.m, p.d, OPEN_MIN) };
  }
  if (p.minutes < close) {
    return { open: true, label: "Open", nextChange: etInstant(p.y, p.m, p.d, close) };
  }
  return { open: false, label: "After hours", reason: "after-hours", nextChange: nextOpenAfter(p.y, p.m, p.d) };
}

const TIME_FMT = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });

/** "9:30am" / "4:00pm" in ET. */
export function formatEtTime(date: Date): string {
  return TIME_FMT.format(date).replace(" ", "").toLowerCase();
}

/** "opens Mon 9:30am ET", or "opens 9:30am ET" when the open is later today (ET). */
export function formatNextOpen(nextChange: Date, now: Date = new Date()): string {
  const a = etParts(now);
  const b = etParts(nextChange);
  const sameDay = a.y === b.y && a.m === b.m && a.d === b.d;
  const day = sameDay ? "" : `${DAY_FMT.format(nextChange)} `;
  return `opens ${day}${formatEtTime(nextChange)} ET`;
}

/** "closes 4:00pm ET" (or "closes 1:00pm ET" on an early-close day). */
export function formatNextClose(nextChange: Date): string {
  return `closes ${formatEtTime(nextChange)} ET`;
}

/** The right phrase for a status: "closes 4:00pm ET" while open, "opens Mon 9:30am ET" otherwise. */
export function describeNextChange(s: MarketStatus, now: Date = new Date()): string {
  return s.open ? formatNextClose(s.nextChange) : formatNextOpen(s.nextChange, now);
}

// ── The one local-time "opens ..." formatter (design critique P0 #1) ──
//
// Before this, the same fact had three spellings: MarketScreen's header said "opens Mon 9:30am
// ET" (formatNextOpen above, always America/New_York), MarketStatusBadge and AssetDetailScreen
// each rolled their own bare `toLocaleString` with no zone label, and the server refusal in
// binanceLegs.ts also said "ET". A viewer in Mumbai read three different clocks for the same
// closed market. This is the only place any BSC-facing surface should format a next-open
// instant: it reads in the caller's OWN local zone (`Intl.DateTimeFormat` with no `timeZone`
// resolves to the runtime's — the viewer's — zone) and always says so ("your time"), so nobody
// has to know what "ET" means.
const LOCAL_OPEN_TIME_FMT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const LOCAL_OPEN_DAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short" });

/** "opens 6:30 PM your time" (today), or "opens Mon 6:30 PM your time" (a different local day). */
export function formatOpensLocal(nextOpenMs: number, nowMs: number = Date.now()): string {
  const next = new Date(nextOpenMs);
  const now = new Date(nowMs);
  const sameLocalDay =
    next.getFullYear() === now.getFullYear() && next.getMonth() === now.getMonth() && next.getDate() === now.getDate();
  const day = sameLocalDay ? "" : `${LOCAL_OPEN_DAY_FMT.format(next)} `;
  return `opens ${day}${LOCAL_OPEN_TIME_FMT.format(next)} your time`;
}

// ── BSC RWA catalog support (docs/BINANCE-WEB3.md §2) ──
//
// bStock rows report no session at all (`marketStatus`/`nextOpenTime`/`nextCloseTime` are
// always null), so the catalog falls back to Stax's own calendar instead of guessing from
// `openState`. These two exports are that fallback: `usMarketState` reads finer than the
// open/closed binary above (pre-market and after-hours split into their own states, which
// `rwa.ts`'s `MarketState` already has room for), and `nextUsOpenMs` is the plain "opens at"
// instant a disabled buy button needs. Both reuse the trading-day calendar above rather than
// re-deriving weekends/holidays, so a BSC row and a Base row never disagree about which days
// the NYSE is open.
const PREMARKET_START_MIN = 4 * 60; // 04:00 ET
const POSTMARKET_END_MIN = 20 * 60; // 20:00 ET

/** Stax's finer-grained session label for `nowMs`, on the NYSE calendar above. */
export function usMarketState(nowMs: number): MarketState {
  const p = etParts(new Date(nowMs));
  if (!isTradingDay(p.y, p.m, p.d)) return "closed";
  const close = closeMinutes(p.y, p.m, p.d);
  if (p.minutes < PREMARKET_START_MIN) return "overnight";
  if (p.minutes < OPEN_MIN) return "premarket";
  if (p.minutes < close) return "open";
  if (p.minutes < POSTMARKET_END_MIN) return "postmarket";
  return "overnight";
}

/** The next regular-session open (09:30 ET) at or after `nowMs`, as epoch ms. */
export function nextUsOpenMs(nowMs: number): number {
  const p = etParts(new Date(nowMs));
  if (isTradingDay(p.y, p.m, p.d) && p.minutes < OPEN_MIN) {
    return etInstant(p.y, p.m, p.d, OPEN_MIN).getTime();
  }
  return nextOpenAfter(p.y, p.m, p.d).getTime();
}

/** What `usMarketClock` reports — a `stateLabel`-ready view of the NYSE calendar clock. */
export interface UsMarketClock {
  state: MarketState;
  buyable: boolean;
  nextOpenMs: number | null;
}

/**
 * The one view of "is the US market open" for surfaces that describe the whole market rather
 * than one venue — MarketScreen's header and AssetDetailScreen's fallback while a venue hasn't
 * loaded yet. Before this, the header rendered `<MarketStatus />`, which speaks ET through its
 * own `describeNextChange`, right above row badges already speaking local time through
 * `stateLabel`/`formatOpensLocal` (design critique P0 #1) — two clocks answering the same
 * question differently on one screen. Feeding this shape into `stateLabel` instead can only ever
 * agree with a row's own badge, because both end in the same formatter.
 */
export function usMarketClock(nowMs: number): UsMarketClock {
  const state = usMarketState(nowMs);
  const buyable = state === "open";
  return { state, buyable, nextOpenMs: buyable ? null : nextUsOpenMs(nowMs) };
}

/** Plain-words reason for a closed market, for the explainer sheet. */
export function closedReasonText(s: MarketStatus): string {
  switch (s.reason) {
    case "weekend":
      return "It's the weekend.";
    case "holiday":
      return "It's a US market holiday.";
    case "after-hours":
      return s.label === "Pre-market" ? "It hasn't opened yet today." : "It's closed for the day.";
    default:
      return "";
  }
}
