// Which issuer AssetDetailScreen treats as "chosen" for the price, the Buy button and the chart.
// Extracted so the rule is unit-testable (screens/hooks can't be imported in the node vitest
// env) — the bug this closes: a board row said "Ondo is $0.40 cheaper" and linked to
// `go("asset", { symbol, venue: "ondo" })`, but the screen still opened on bStock because its
// local pick started at `undefined` and ignored the incoming `venue` entirely.
//
// Precedence: an explicit tap on the Venues panel (`pickedVenue`) beats the issuer the screen
// was opened with (`openedVenue` — a board row or a twin holding's own venue), which beats the
// catalog's own best pick (`defaultVenue`). Whichever of the first two is "wanted" only wins
// when it's actually buyable right now — a picked or opened venue that paused mid-visit falls
// back the same way VenuePicker's own selection ring does, rather than keep pointing Buy at a
// venue that just went dark.
import type { RwaPlatform } from "./chains";

export interface VenueBuyability {
  platform: RwaPlatform;
  buyable: boolean;
}

export function chosenVenueFor(
  pickedVenue: RwaPlatform | undefined,
  openedVenue: RwaPlatform | undefined,
  venues: readonly VenueBuyability[] | undefined,
  defaultVenue: RwaPlatform | undefined,
): RwaPlatform | undefined {
  const wanted = pickedVenue ?? openedVenue;
  const wantedLive = wanted !== undefined && (venues?.some((v) => v.platform === wanted && v.buyable) ?? false);
  return wantedLive ? wanted : defaultVenue;
}

/**
 * The other issuer Trade can offer ("Buy from Ondo instead · open now") — only when the one
 * this trade uses is closed and the other is open right now (design critique P1 #9).
 */
export function otherOpenVenue(
  chosen: RwaPlatform | undefined,
  venues: readonly VenueBuyability[] | undefined,
): RwaPlatform | undefined {
  if (!chosen || !venues) return undefined;
  const mine = venues.find((v) => v.platform === chosen);
  if (!mine || mine.buyable) return undefined;
  return venues.find((v) => v.platform !== chosen && v.buyable)?.platform;
}
