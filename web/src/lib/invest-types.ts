// Shared client-side types for the allocate -> plan -> send flow.
// These mirror the JSON the API routes return (all bigints serialized as strings).
import type { Allocation } from "./allocation-schema";
import type { ChainKey } from "./chains/types";
import type { DryRun } from "./dryRun";
import type { ExecCall } from "./execution";

/** POST /api/allocate response. */
export interface AllocateResult extends Allocation {
  amountUsd: number;
  model: string;
  /** Chain the allocation was built for (its investable universe). */
  chain: ChainKey;
}

/** A swap leg as returned by /api/invest-plan (bigints serialized). */
export interface SerializedLeg {
  router: `0x${string}`;
  tokenOut: `0x${string}`;
  usdcIn: string;
  minOut: string;
  swapData: `0x${string}`;
}

/** Plan struct (serialized) for StaxExecutor.investWithAI. */
export interface SerializedPlan {
  planId: `0x${string}`;
  recHash: `0x${string}`;
  riskScore: number;
  agentId: string;
}

/** Inference struct (serialized). */
export interface SerializedInference {
  assessedRisk: number;
  maxRisk: number;
  expiry: string;
  signature: `0x${string}`;
}

/** POST /api/invest-plan response. */
export interface InvestPlanResult {
  plan: SerializedPlan;
  inference: SerializedInference;
  legs: SerializedLeg[];
  usdcTotal: string;
  /** Chain the plan was signed for — the client must send the UserOp on this chain. */
  chain: ChainKey;
  /** StaxExecutor on `chain` (approve target + investWithAI callee). */
  executor: `0x${string}`;
  /** Explorer base URL for `chain` (e.g. https://basescan.org) so the client never guesses. */
  explorer: string;
  notes: string[];
  /**
   * Direct smart-account path (ADR-0005): present instead of being sent through the executor
   * when `chain.contracts.deployed` is false (BSC today). The client sends these calls
   * verbatim, in order, as one sponsored user op — see `assertExecCallsAreSafe` in
   * `lib/execution.ts`. `plan`/`inference`/`legs`/`usdcTotal` above are still required by the
   * type (existing callers such as useGifts.ts read them unconditionally on the executor path)
   * but are meaningless when `calls` is present, and a client on that path ignores them.
   */
  calls?: ExecCall[];
  /**
   * Direct path only: one Binance Transaction API dry run per leg in `calls`, same order as
   * the allocation's legs. Never claims a check that didn't run — the client must not send
   * this plan if any entry here has status "failed" (see lib/dryRun.ts).
   */
  dryRuns?: DryRun[];
}

/** A receipt-ish summary surfaced to the success screen. */
export interface InvestSuccess {
  txHash: `0x${string}`;
  holdings: { symbol: string; name: string; weightPct: number; amountUsd: number }[];
  amountUsd: number;
  /** The on-chain AI verification this plan passed (for the "Verified on-chain" panel). */
  verification?: {
    riskScore: number; // assessed portfolio risk, bps
    maxRisk: number; // ceiling the agent signed off on, bps
    planId: `0x${string}`;
    agentId: string;
    signature: `0x${string}`;
  };
}
