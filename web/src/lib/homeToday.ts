// Home's one-line "Today" fact on BSC, and Market's header: whether the US stock market — the
// reference every tokenized stock here tracks — is open right now, in the viewer's own words and
// own clock. It composes marketHours.ts's `usMarketClock` (the single "is the US market open"
// answer) with `formatOpensLocal`/`formatClosesLocal` (the one local-time formatter every BSC
// market line uses), so Home, Market and Asset detail never disagree about what time it is.
//
// Always names "US market": a bare "Open now" on Home sat next to Ondo rows trading overnight
// and a "Closed" header, and read as three different answers to one question (design critique
// P0 #2). The subject here is the stock market; an issuer's own hours are said by name.
import { usMarketClock, formatOpensLocal, formatClosesLocal, nextUsCloseMs } from "./marketHours";

/** "US market open · closes 10:00 PM your time" / "US market closed · opens Mon 9:30 AM your time". */
export function todayMarketLine(nowMs: number): string {
  const clock = usMarketClock(nowMs);
  if (clock.buyable) {
    const closeMs = nextUsCloseMs(nowMs);
    return closeMs !== null ? `US market open · ${formatClosesLocal(closeMs, nowMs)}` : "US market open";
  }
  // usMarketClock only omits nextOpenMs when buyable (see its own doc comment), so this is
  // always a real instant here — the `?? nowMs` is just a defensive floor, never expected to fire.
  return `US market closed · ${formatOpensLocal(clock.nextOpenMs ?? nowMs, nowMs)}`;
}

/**
 * Market's header: the same line as Home, plus — only while the US market is closed and an
 * issuer is still filling orders — who you can still buy through. `openIssuers` are display
 * names ("Ondo"), deduplicated by the caller.
 */
export function marketHeaderLine(nowMs: number, openIssuers: readonly string[]): string {
  const line = todayMarketLine(nowMs);
  if (usMarketClock(nowMs).buyable || openIssuers.length === 0) return line;
  const who = openIssuers.length === 1 ? openIssuers[0] : `${openIssuers.slice(0, -1).join(", ")} and ${openIssuers[openIssuers.length - 1]}`;
  return `${line} · some stocks still trade through ${who}`;
}
