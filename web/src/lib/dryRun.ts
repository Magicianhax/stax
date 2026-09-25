// The result of checking a BSC trade with the Binance Transaction API before the user signs it.
// Client-safe: /api/swap-quote and /api/invest-plan attach it, TradeScreen and PlanScreen show it.
// `status` is honest about what ran: "passed" only when Binance simulated the exact calls the user
// will sign and they succeeded; "skipped" when no simulation was possible (say why); "failed" when
// Binance said the trade would revert. The UI never shows "checked" for anything but "passed".
export type DryRunStatus = "passed" | "failed" | "skipped";

export interface DryRun {
  status: DryRunStatus;
  /** What the account is expected to receive, in raw units of `token`, when status is "passed". */
  receiveRaw?: string;
  token?: `0x${string}`;
  /**
   * /api/invest-plan only: the plan leg this check belongs to. PlanScreen matches checks to
   * legs by this (then by `token`), never by position.
   */
  symbol?: string;
  /** Plain-words reason for "failed" or "skipped", safe to show a first-time investor. */
  reason?: string;
  /** Epoch ms of the Binance call. */
  checkedAt: number;
}
