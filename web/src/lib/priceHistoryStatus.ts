// PriceVsRealShare's own three-way read of a ticker's price-vs-real-share history: never a
// blank chart. "empty" — nothing has ever been recorded for this venue — earns a single plain
// sentence, not a chart shell with a placeholder inside it. "thin" — a snapshot or two exist but
// not enough to draw a line between two points — keeps the quieter "check back soon" placeholder.
// "chart" draws the two lines. Pure and tiny on purpose: this is the one branch a screen or
// component (neither importable in the vitest node env) would otherwise have to get right on its
// own, so it lives here and is tested directly.
export type HistoryStatus = "chart" | "empty" | "thin";

export function historyStatus(pointCount: number): HistoryStatus {
  if (pointCount <= 0) return "empty";
  if (pointCount < 2) return "thin";
  return "chart";
}
