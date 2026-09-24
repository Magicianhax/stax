// Which issuer IssuerBoardScreen should pre-select when a "Which is cheaper?" row is tapped.
// The board's own row (`SpreadBoardRow.cheaper`, from `issuerDifference` in lib/spread.ts) is
// the plain cheapest price with no regard for whether that issuer is buyable right now. The
// per-ticker call (`SpreadTickerCall.cheaperIssuer`, from `cheaperIssuerNow`) is the buyable-
// aware version of the same question — it only falls back to the plain-cheaper issuer when
// neither venue is buyable — so it's the one a tap should open on. The board row stays as the
// fallback for the case a ticker call is missing from the response.
import type { RwaPlatform } from "./chains";
import type { SpreadBoardRow, SpreadTickerCall } from "./spread";

export function boardRowTargetVenue(
  ticker: string,
  board: readonly Pick<SpreadBoardRow, "ticker" | "cheaper">[],
  tickers: readonly Pick<SpreadTickerCall, "ticker" | "cheaperIssuer">[],
): RwaPlatform | undefined {
  const call = tickers.find((t) => t.ticker === ticker)?.cheaperIssuer;
  if (call) return call;
  return board.find((r) => r.ticker === ticker)?.cheaper;
}
