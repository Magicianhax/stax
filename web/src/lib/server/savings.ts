import "server-only";

// Savings — Stax's name for one BSC lending product: Venus's USDT market, discovered LIVE
// through the Binance DeFi API (docs/BINANCE-WEB3.md's DeFi section, 2026-09-25) and pinned here
// rather than looked up per request, so a deposit or redeem can never be redirected to a
// different investment product by a Binance response. The safety bar matches a buy: every call
// this module hands back is checked by `assertSavingsCallsAreSafe` (lib/execution.ts) against a
// two-address allowlist (cash, the pinned Venus contract) before a client ever sees it.
import { buildDeposit, buildRedeem, investmentDetail } from "./binance/defi";
import { BinanceWeb3Error } from "./binance/types";
import { assertSavingsCallsAreSafe, type ExecCall } from "@/lib/execution";
import type { StaxChain } from "@/lib/chains/types";

/**
 * Venus's USDT Earn market on BSC (`investmentId`, from `POST /api/v1/defi/data/investment/list`
 * filtered to `defiProtocolId: "venus"`). LIVE-verified 2026-09-25: `investmentDetail` on this id
 * returns Venus/USDT/investable:true, and a build-deposit call for it targets the vUSDT address
 * `assertSavingsCallsAreSafe` pins. Not re-discovered per request — a hardcoded id is the whole
 * point of "Savings is one product," not a general DeFi product picker.
 */
export const VENUS_USDT_INVESTMENT_ID = "5b77bfd8d8f7c18e9ee0d8f331c4d78f56744eed8addbe2e9970c0ef37e763cb";

export interface SavingsRate {
  apyBps: number;
  /** Binance's own formatted string ("3.38%") — shown verbatim, never re-derived from apyBps. */
  apyDisplay: string;
}

/** A user-facing refusal (bad chain, bad amount, no position to redeem) — safe to show verbatim,
 *  same split as BinanceLegRefusal / AllocationRefusal elsewhere in lib/server. Never a 500. */
export class SavingsRefusal extends Error {}

const RATE_TTL_MS = 5 * 60_000;
let rateCache: { at: number; value: SavingsRate | null } | undefined;

/**
 * The current Venus USDT rate, cached 5 minutes (APY moves slowly; this is read on every
 * WalletScreen view). Never invents a number: any Binance failure, or Binance itself saying the
 * product isn't investable right now, returns `null` so the card shows "rate unavailable" once
 * the cache goes stale — not a frozen old figure and not a guess.
 */
export async function getSavingsRate(): Promise<SavingsRate | null> {
  if (rateCache && Date.now() - rateCache.at < RATE_TTL_MS) return rateCache.value;
  let value: SavingsRate | null;
  try {
    const detail = await investmentDetail(VENUS_USDT_INVESTMENT_ID);
    value = detail.investable ? { apyBps: detail.apyBps, apyDisplay: detail.apyDisplay } : null;
  } catch (err) {
    console.warn("[savings] rate unavailable:", err instanceof Error ? err.message : err);
    value = null;
  }
  rateCache = { at: Date.now(), value };
  return value;
}

function assertBscAndPositiveAmount(chain: StaxChain, amountUsd: number): void {
  if (chain.key !== "bsc") throw new SavingsRefusal("Savings is only available on BNB Chain right now.");
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new SavingsRefusal("Enter an amount first.");
}

/**
 * Unsigned calls to move `amountUsd` of BSC cash into Savings: Binance's own deposit build
 * (exact-amount approve, when the wallet needs one, then deposit — see defi.ts), checked against
 * the Savings allowlist before returning. `amountUsd` is a human decimal, matching Binance's own
 * DeFi API (not raw units — this bypasses lib/units.ts on purpose; see defi.ts's doc comment).
 */
export async function buildSavingsDeposit(chain: StaxChain, address: `0x${string}`, amountUsd: number): Promise<ExecCall[]> {
  assertBscAndPositiveAmount(chain, amountUsd);
  const calls = await buildDeposit({
    address,
    investmentId: VENUS_USDT_INVESTMENT_ID,
    tokenAddress: chain.usdc.address,
    amountHuman: String(amountUsd),
  });
  return assertSavingsCallsAreSafe(chain, calls);
}

/**
 * Unsigned calls to redeem `ratio` (0, 1] of the caller's Venus USDT position back to cash.
 * Binance's own "no position found" (40456 — seen LIVE for a wallet with nothing deposited)
 * becomes a plain `SavingsRefusal`, not an internal-fault 500: it's an honest, expected answer
 * for "you have nothing to move out," the same class of thing bscPlan.ts / binanceLegs.ts do for
 * a trade Binance refuses for a normal, explainable reason.
 */
export async function buildSavingsRedeem(chain: StaxChain, address: `0x${string}`, ratio: number): Promise<ExecCall[]> {
  if (chain.key !== "bsc") throw new SavingsRefusal("Savings is only available on BNB Chain right now.");
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new SavingsRefusal("Enter how much to move out.");
  let calls: ExecCall[];
  try {
    calls = await buildRedeem({ address, investmentId: VENUS_USDT_INVESTMENT_ID, ratio: String(ratio) });
  } catch (err) {
    if (err instanceof BinanceWeb3Error && err.code === 40456) {
      throw new SavingsRefusal("You don't have savings to move out yet.");
    }
    throw err;
  }
  return assertSavingsCallsAreSafe(chain, calls);
}
