// A nudge on the plan screen selects a new tone chip, then asks the server to rebuild the plan. If
// the server says no (market closed since the plan was built, under $6 a stock, a bad request) the
// old plan stays on screen, so the chip must fall back to the tone that plan was built with —
// otherwise the screen shows "Bolder" selected over a plan that is not bolder.

/** The tone to keep selected once a nudge's rebuild finishes: the new one if a plan came back, else the old one. */
export async function toneAfterNudge<T>(previous: T, next: T, rebuild: () => Promise<unknown | null>): Promise<T> {
  const plan = await rebuild();
  return plan ? next : previous;
}
