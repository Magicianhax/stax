import "server-only";

// A Binance Transaction API dry run for a BSC trade, right before the user signs it (the
// brief's "Dry-run with the Transaction API"). Wired into /api/swap-quote (build=true),
// /api/invest-plan's direct path (one per leg) and its executor path on BNB Chain (one per plan,
// dryRunBscExecutorBatch, reported per leg).
//
// The known obstacle (docs/BINANCE-WEB3.md §5, §10, live 2026-09-24): `POST
// /pre-transaction/simulate` takes ONE unsigned tx — its request body is a single `evmTx`
// object, never a list, and no state-override field is accepted either (both re-confirmed
// LIVE for wave 5) — and a swap from an account that hasn't approved the router yet reverts on
// the very first `transferFrom` that pulls the input token in, before the swap's output leg
// ever runs. Simulating the swap ALONE would therefore only ever prove the allowance failure —
// and on BSC that isn't just a first-trade edge case: every approval here is exact-amount and
// single-use (directCallsForLeg in binanceLegs.ts, useSwap's aggregatorCalls), so the account's
// on-chain allowance to the router is back to zero right after every trade, not only the first.
//
// The fix: don't simulate the swap alone — simulate the WHOLE thing the user is about to sign,
// [approve, swap], as one call from the EntryPoint to the smart account. That mirrors ERC-4337
// exactly: `EntryPoint.innerHandleOp` calls the account directly with the batch calldata, so
// the account sees `msg.sender == the EntryPoint` (permissionless.js's SimpleSmartAccount,
// lib/aa.ts, entryPoint v0.7). The approve and the swap then run atomically inside that one
// call, exactly as they will on-chain, so this works regardless of the CURRENT allowance —
// first trade of a token or the hundredth.
//
// The one real limit (confirmed LIVE for wave 5, docs/BINANCE-WEB3.md §5): Binance's simulator
// flatly refuses a `to` address with no deployed bytecode — a clean `40001` "Parameter error",
// never a misleading SUCCESS — so a smart account that hasn't sent its first on-chain trade yet
// (no code deployed there yet) genuinely cannot be dry-run this way; `EntryPoint`'s own
// `initCode` deployment step has no equivalent in a single `evmTx` simulate call. `serverClient
// .getCode` catches that for free (a read-only RPC call, no Binance budget spent) before ever
// calling Binance, and the skip reason says exactly that — never blaming an unapproved router,
// since approval is no longer what's being checked. This file NEVER returns "passed" for a
// trade Binance didn't actually simulate.
import { decodeFunctionData, encodeFunctionData } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { ERC20_ABI } from "@/lib/abis";
import type { DryRun } from "@/lib/dryRun";
import { serverClient } from "@/lib/server/chain";
import type { StaxChain } from "@/lib/chains/types";
import type { ExecCall } from "@/lib/execution";
import { getBinanceWeb3 } from "./binance";
import type { EvmTx, SimulateResult } from "./binance/types";

/**
 * permissionless.js's SimpleSmartAccount (lib/aa.ts, EntryPoint v0.7) encodes a multi-call
 * UserOperation as `executeBatch(address[] dest, uint256[] value, bytes[] func)` — see
 * `node_modules/permissionless/accounts/simple/toSimpleSmartAccount.ts`. Every call this file
 * simulates is a plain contract call (approve, swap), never one that sends BNB.
 */
const EXECUTE_BATCH_07_ABI = [
  {
    inputs: [
      { internalType: "address[]", name: "dest", type: "address[]" },
      { internalType: "uint256[]", name: "value", type: "uint256[]" },
      { internalType: "bytes[]", name: "func", type: "bytes[]" },
    ],
    name: "executeBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/** The exact calldata a SimpleSmartAccount (EntryPoint v0.7) executes for a batch of calls. */
export function encodeSimpleAccountExecuteBatch(calls: { to: `0x${string}`; data: `0x${string}` }[]): `0x${string}` {
  return encodeFunctionData({
    abi: EXECUTE_BATCH_07_ABI,
    functionName: "executeBatch",
    args: [calls.map((c) => c.to), calls.map(() => BigInt(0)), calls.map((c) => c.data)],
  });
}

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
  /** Whether `address` has deployed bytecode right now (an undeployed SimpleAccount doesn't). */
  isAccountDeployed: (chain: StaxChain, address: `0x${string}`) => Promise<boolean>;
  simulate: (tx: EvmTx) => Promise<SimulateResult>;
}

async function onChainIsDeployed(chain: StaxChain, address: `0x${string}`): Promise<boolean> {
  const code = await serverClient(chain).getCode({ address });
  return Boolean(code) && code !== "0x";
}

const defaultDeps: DryRunDeps = {
  isAccountDeployed: onChainIsDeployed,
  simulate: (tx) => getBinanceWeb3().simulate(tx),
};

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
  if (lower.includes("insufficient") || lower.includes("exceeds balance")) {
    return "There isn't enough balance to complete this trade.";
  }
  return "Binance checked this trade and it wouldn't go through right now. Try again in a moment.";
}

type BatchOutcome =
  | { kind: "skipped"; reason: string; checkedAt: number }
  | { kind: "failed"; reason: string; checkedAt: number }
  | { kind: "passed"; result: SimulateResult; checkedAt: number };

const COULD_NOT_CHECK = "Couldn't check this trade with Binance just now.";
const NOT_DEPLOYED_YET = "This check turns on after your wallet's very first trade sets it up on-chain.";

/**
 * Simulates `calls` exactly as the smart account will execute them — one executeBatch call from
 * the EntryPoint — spending at most one Binance call. Zero when the account has no code yet (a
 * read-only RPC check first); a failed deployment check or a Binance error skip rather than block.
 */
async function simulateAccountBatch(
  chain: StaxChain,
  taker: `0x${string}`,
  calls: { to: `0x${string}`; data: `0x${string}` }[],
  deps: DryRunDeps,
): Promise<BatchOutcome> {
  let deployed: boolean;
  try {
    deployed = await deps.isAccountDeployed(chain, taker);
  } catch {
    return { kind: "skipped", reason: COULD_NOT_CHECK, checkedAt: Date.now() };
  }
  if (!deployed) return { kind: "skipped", reason: NOT_DEPLOYED_YET, checkedAt: Date.now() };

  let result: SimulateResult;
  try {
    result = await deps.simulate({ from: entryPoint07Address, to: taker, value: "0", data: encodeSimpleAccountExecuteBatch(calls) });
  } catch {
    return { kind: "skipped", reason: COULD_NOT_CHECK, checkedAt: Date.now() };
  }
  const checkedAt = Date.now();
  if (result.status !== "SUCCESS") return { kind: "failed", reason: plainFailReason(result.failReason), checkedAt };
  return { kind: "passed", result, checkedAt };
}

/**
 * The one entry point every caller uses. Spends at most one Binance call: zero when the
 * account hasn't sent its first on-chain trade yet (no deployed bytecode to simulate against),
 * one otherwise — regardless of the account's current allowance, because the approve and the
 * swap are simulated together, atomically, exactly as the account will sign them. A failed
 * deployment check or a Binance error both skip rather than block — this check is a courtesy
 * on top of the trade, never a gate that can 500 it.
 */
export async function dryRunBscSwap(args: DryRunSwapArgs, deps: DryRunDeps = defaultDeps): Promise<DryRun> {
  const { chain, taker, router, tokenIn, tokenOut, amountIn, swapData } = args;
  const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [router, amountIn] });
  const outcome = await simulateAccountBatch(
    chain,
    taker,
    [
      { to: tokenIn, data: approveData },
      { to: router, data: swapData },
    ],
    deps,
  );
  if (outcome.kind !== "passed") return { status: outcome.kind, reason: outcome.reason, checkedAt: outcome.checkedAt };

  const receiveRaw = parseReceivedAmount(outcome.result.balanceChanges, tokenOut, taker);
  return {
    status: "passed",
    token: tokenOut,
    checkedAt: outcome.checkedAt,
    ...(receiveRaw !== undefined ? { receiveRaw: receiveRaw.toString() } : {}),
  };
}

export interface DryRunExecutorBatchArgs {
  chain: StaxChain;
  /** The smart account that signs and sends the batch (the executor forwards every leg to it). */
  taker: `0x${string}`;
  /** The exact batch the client sends: [approve(cash, executor, usdcTotal), investWithAI(...)]. */
  calls: { to: `0x${string}`; data: `0x${string}` }[];
  /** One entry per plan leg: which stock it is and the token it buys, in plan order. */
  legs: { symbol: string; token: `0x${string}` }[];
}

/**
 * The executor path's Binance check (/api/invest-plan on BNB Chain): the account sends ONE batch
 * for the whole plan — approve the executor for exactly usdcTotal, then investWithAI — so that
 * batch is simulated once, byte for byte, from the EntryPoint (one Binance call per plan, not per
 * leg). The response keeps the direct path's shape: one DryRun per leg, tagged with its symbol and
 * token, so useInvest's "a failed check is never sent" and PlanScreen's per-leg lines read it
 * unchanged. A pass reads each leg's own receipt off the account's row (the executor forwards what
 * it measured); a revert can't be pinned to one leg, so every leg reads "failed"; a skip says why,
 * on every leg. Never "passed" for anything Binance didn't simulate.
 */
export async function dryRunBscExecutorBatch(args: DryRunExecutorBatchArgs, deps: DryRunDeps = defaultDeps): Promise<DryRun[]> {
  const { chain, taker, calls, legs } = args;
  const outcome = await simulateAccountBatch(chain, taker, calls, deps);
  return legs.map((leg): DryRun => {
    const tag = { symbol: leg.symbol, token: leg.token };
    if (outcome.kind !== "passed") return { status: outcome.kind, reason: outcome.reason, checkedAt: outcome.checkedAt, ...tag };
    const receiveRaw = parseReceivedAmount(outcome.result.balanceChanges, leg.token, taker);
    return {
      status: "passed",
      checkedAt: outcome.checkedAt,
      ...tag,
      ...(receiveRaw !== undefined ? { receiveRaw: receiveRaw.toString() } : {}),
    };
  });
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
