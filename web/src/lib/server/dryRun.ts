import "server-only";

// A Binance Transaction API dry run for a BSC trade, right before the user signs it (the
// brief's "Dry-run with the Transaction API"). Wired into /api/swap-quote (build=true) and
// /api/invest-plan's direct path, one per leg.
//
// The known obstacle (docs/BINANCE-WEB3.md §5, §10, resolved live against a real $6
// USDT->NVDAB quote on 2026-09-24): `POST /pre-transaction/simulate` takes ONE unsigned tx —
// its request body is a single `evmTx` object, never a list — and a swap from an account that
// hasn't approved the router yet reverts on the very first `transferFrom` that pulls the input
// token in, before the swap's output leg ever runs. So calling `simulate` on the swap alone,
// for a first-time trade, would only ever prove the allowance failure — never anything about
// the swap itself — and reporting that as "checked" would be dishonest. Instead: read the
// account's CURRENT on-chain allowance to the router first (one read-only RPC call, no
// Binance budget spent). Only when it already covers this trade do we spend the one Binance
// call `simulate` costs; otherwise this says so in plain words and skips, and this file NEVER
// returns "passed" for a trade Binance didn't actually simulate.
import { decodeFunctionData } from "viem";
import { ERC20_ABI } from "@/lib/abis";
import type { DryRun } from "@/lib/dryRun";
import { serverClient } from "@/lib/server/chain";
import type { StaxChain } from "@/lib/chains/types";
import type { ExecCall } from "@/lib/execution";
import { getBinanceWeb3 } from "./binance";
import type { EvmTx, SimulateResult } from "./binance/types";

export interface DryRunSwapArgs {
  chain: StaxChain;
  /** The smart account that will sign and send this trade. */
  taker: `0x${string}`;
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  /** Raw units of `tokenIn`, exactly what the pending `approve` call sets the allowance to. */
  amountIn: bigint;
  /** The router calldata this trade will actually send — simulated byte for byte. */
  swapData: `0x${string}`;
}

/** Swapped out in tests so nothing here makes a real RPC or Binance call. */
export interface DryRunDeps {
  readAllowance: (chain: StaxChain, owner: `0x${string}`, token: `0x${string}`, spender: `0x${string}`) => Promise<bigint>;
  simulate: (tx: EvmTx) => Promise<SimulateResult>;
}

async function onChainAllowance(
  chain: StaxChain,
  owner: `0x${string}`,
  token: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return serverClient(chain).readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  }) as Promise<bigint>;
}

const defaultDeps: DryRunDeps = {
  readAllowance: onChainAllowance,
  simulate: (tx) => getBinanceWeb3().simulate(tx),
};

/** True when the account would still need to approve the router before this exact trade. */
export function needsApprovalFirst(allowance: bigint, amountIn: bigint): boolean {
  return allowance < amountIn;
}

/**
 * What the taker actually received in `token`, from a simulate response's `balanceChanges`.
 * Matches on the taker's OWN row (not just the token) so a router's internal hop through the
 * same token can never be mistaken for the user's receipt. `change` is a signed decimal
 * string; a receipt is always the magnitude (Binance has shown a negative-signed net change
 * on some rows even for what a user experiences as an inflow, so the sign is not trusted).
 */
export function parseReceivedAmount(
  balanceChanges: SimulateResult["balanceChanges"],
  token: `0x${string}`,
  taker: `0x${string}`,
): bigint | undefined {
  const row = balanceChanges.find(
    (c) => c.contractAddress.toLowerCase() === token.toLowerCase() && c.owner.toLowerCase() === taker.toLowerCase(),
  );
  if (!row) return undefined;
  try {
    const n = BigInt(row.change);
    return n < BigInt(0) ? -n : n;
  } catch {
    return undefined;
  }
}

/**
 * Binance's `failReason` is a raw revert string ("execution reverted: BEP20: transfer amount
 * exceeds allowance") — exactly the on-chain jargon the copy rules ban. This is the one place
 * that turns it into something a first-time investor can read. Deliberately generic: the
 * point is never to explain the mechanism, only to say the check came back bad and that
 * trying again is reasonable.
 */
export function plainFailReason(failReason: string): string {
  if (!failReason) return "Binance checked this trade and it wouldn't go through right now.";
  const lower = failReason.toLowerCase();
  if (lower.includes("allowance")) return "This trade needs one more approval step first.";
  if (lower.includes("insufficient") || lower.includes("exceeds balance")) {
    return "There isn't enough balance to complete this trade.";
  }
  return "Binance checked this trade and it wouldn't go through right now. Try again in a moment.";
}

/**
 * The one entry point every caller uses. Spends at most one Binance call: zero when the
 * account still needs to approve the router (the common case for a first-time buy of a
 * token), one otherwise. A failed allowance read or a Binance error both skip rather than
 * block — this check is a courtesy on top of the trade, never a gate that can 500 it.
 */
export async function dryRunBscSwap(args: DryRunSwapArgs, deps: DryRunDeps = defaultDeps): Promise<DryRun> {
  const { chain, taker, router, tokenIn, tokenOut, amountIn, swapData } = args;

  let allowance: bigint;
  try {
    allowance = await deps.readAllowance(chain, taker, tokenIn, router);
  } catch {
    return { status: "skipped", reason: "Couldn't check this trade with Binance just now.", checkedAt: Date.now() };
  }

  if (needsApprovalFirst(allowance, amountIn)) {
    return {
      status: "skipped",
      reason: "First trade of this token: Binance can only check it after you approve.",
      checkedAt: Date.now(),
    };
  }

  let result: SimulateResult;
  try {
    result = await deps.simulate({ from: taker, to: router, value: "0", data: swapData });
  } catch {
    return { status: "skipped", reason: "Couldn't check this trade with Binance just now.", checkedAt: Date.now() };
  }

  const checkedAt = Date.now();
  if (result.status !== "SUCCESS") {
    return { status: "failed", reason: plainFailReason(result.failReason), checkedAt };
  }

  const receiveRaw = parseReceivedAmount(result.balanceChanges, tokenOut, taker);
  return {
    status: "passed",
    token: tokenOut,
    checkedAt,
    ...(receiveRaw !== undefined ? { receiveRaw: receiveRaw.toString() } : {}),
  };
}

/**
 * /api/invest-plan's direct path (buildBscInvestCalls in lib/server/bscPlan.ts, owned by
 * another stream this wave) returns one flat calls array, always exactly [approve, swap] per
 * leg (directCallsForLeg in binanceLegs.ts) in the same order as the allocation's legs. This
 * pairs them back up so invest-plan can run one dry run per leg without importing anything
 * from bscPlan.ts. Throws on an odd count rather than silently mis-pairing — that would mean
 * the [approve, swap]-per-leg invariant changed upstream, and guessing a grouping here could
 * simulate the wrong swap against the wrong approval.
 */
export function pairLegCalls(calls: ExecCall[]): { approve: ExecCall; swap: ExecCall }[] {
  if (calls.length % 2 !== 0) {
    throw new Error(`pairLegCalls: expected [approve, swap] pairs, got ${calls.length} calls.`);
  }
  const pairs: { approve: ExecCall; swap: ExecCall }[] = [];
  for (let i = 0; i < calls.length; i += 2) pairs.push({ approve: calls[i], swap: calls[i + 1] });
  return pairs;
}

/**
 * The exact amount a leg's own `approve(spender, amount)` call sets — this is `amountIn` for
 * that leg's dry run, read back out of the calldata invest-plan is about to hand the client
 * rather than threaded through as a separate value. `undefined` for anything that doesn't
 * decode as `approve`, so a caller never mistakes a decoding failure for a zero amount.
 */
export function decodeApproveAmount(data: `0x${string}`): bigint | undefined {
  try {
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data });
    if (decoded.functionName !== "approve") return undefined;
    return decoded.args[1] as bigint;
  } catch {
    return undefined;
  }
}
