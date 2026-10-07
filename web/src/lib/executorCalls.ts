// The executor-path batch, encoded once: [fee → treasury (when there is one), cash.approve(
// executor, usdcTotal), executor.investWithAI(plan, inference, legs, usdcTotal)]. useInvest sends
// it as one sponsored user op, Autopilot signs it server-side, and /api/invest-plan dry-runs it on
// BNB Chain — all three read this one function, so the batch Binance simulates is byte for byte
// the batch the account sends. Client-safe (no server imports).
import { encodeFunctionData } from "viem";
import { ERC20_ABI, STAX_EXECUTOR_ABI } from "./abis";
import { STAX_TREASURY } from "./fees";
import type { StaxChain } from "./chains/types";

export interface ExecutorPlanArgs {
  planId: `0x${string}`;
  recHash: `0x${string}`;
  riskScore: number;
  agentId: bigint;
}

export interface ExecutorInferenceArgs {
  assessedRisk: number;
  maxRisk: number;
  expiry: bigint;
  signature: `0x${string}`;
}

export interface ExecutorLegArgs {
  router: `0x${string}`;
  tokenOut: `0x${string}`;
  usdcIn: bigint;
  minOut: bigint;
  swapData: `0x${string}`;
}

export interface ExecutorCall {
  to: `0x${string}`;
  data: `0x${string}`;
}

export function executorInvestCalls(a: {
  chain: StaxChain;
  plan: ExecutorPlanArgs;
  inference: ExecutorInferenceArgs;
  legs: readonly ExecutorLegArgs[];
  /** Raw cash units the executor pulls; the approve is for exactly this, never more. */
  usdcTotal: bigint;
  /** Raw cash units of platform fee skimmed first (zero on BNB Chain, ADR-0007). */
  feeRaw: bigint;
}): ExecutorCall[] {
  const usdc = a.chain.usdc.address;
  const executor = a.chain.contracts.executor;
  const calls: ExecutorCall[] = [];
  if (a.feeRaw > BigInt(0)) {
    calls.push({ to: usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, a.feeRaw] }) });
  }
  calls.push({ to: usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [executor, a.usdcTotal] }) });
  calls.push({
    to: executor,
    data: encodeFunctionData({
      abi: STAX_EXECUTOR_ABI,
      functionName: "investWithAI",
      args: [a.plan, a.inference, [...a.legs], a.usdcTotal],
    }),
  });
  return calls;
}
