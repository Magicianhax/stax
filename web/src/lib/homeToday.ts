// Home's one-line "Today" fact on BSC: whether the US stock market — the reference every
// tokenized stock here tracks — is open right now, in the viewer's own words and own clock.
// Deliberately its own tiny module rather than a new export on lib/marketHours.ts (owned by
// another wave-5a stream): it just composes that file's own `usMarketClock` (the single "is the
// US market open" answer MarketScreen's header already reads) with `formatOpensLocal` (the one
// local-time formatter every closed-market line on BSC already uses), so Home can never disagree
// with Market or Asset detail about what time it is.
import { usMarketClock, formatOpensLocal } from "./marketHours";

/** "Open now" / "US market closed · opens Mon 9:30 AM your time". */
export function todayMarketLine(nowMs: number): string {
  const clock = usMarketClock(nowMs);
  if (clock.buyable) return "Open now";
  // usMarketClock only omits nextOpenMs when buyable (see its own doc comment), so this is
  // always a real instant here — the `?? nowMs` is just a defensive floor, never expected to fire.
  return `US market closed · ${formatOpensLocal(clock.nextOpenMs ?? nowMs, nowMs)}`;
}
