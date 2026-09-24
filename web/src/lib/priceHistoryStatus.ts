// AssetDetailScreen's own read of a ticker's price-vs-real-share history: never a blank chart,
// and never a claim about the data before the fetch that would back it up has actually returned.
// "loading"/"error" — the fetch hasn't succeeded yet — render nothing (the chart card simply
// isn't there yet), because "empty" is a specific, true fact (GET /api/rwa/spread/[ticker]
// answered and there is nothing recorded) that a still-loading or failed request hasn't earned.
// Regression: every BSC stock page briefly claimed "we start recording this stock's price
// history" on first paint, and kept claiming it forever on a fetch error, because point count
// alone can't tell "not fetched yet" apart from "fetched and empty". "thin" — a snapshot or two
// exist but not enough to draw a line between two points — keeps the quieter "check back soon"
// placeholder. "chart" draws the two lines. Pure and tiny on purpose: this is the one branch a
// screen or component (neither importable in the vitest node env) would otherwise have to get
// right on its own, so it lives here and is tested directly.
export type HistoryStatus = "loading" | "error" | "chart" | "empty" | "thin";

export interface HistoryQueryState {
  isLoading: boolean;
  isError: boolean;
}

export function historyStatus(pointCount: number, query?: HistoryQueryState): HistoryStatus {
  if (query?.isLoading) return "loading";
  if (query?.isError) return "error";
  if (pointCount <= 0) return "empty";
  if (pointCount < 2) return "thin";
  return "chart";
}
