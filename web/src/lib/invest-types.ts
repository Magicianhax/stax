// Shared client-side types for the allocate -> plan -> send flow.
// These mirror the JSON the API routes return (all bigints serialized as strings).
import type { Allocation } from "./allocation-schema";

/** POST /api/allocate response. */
export interface AllocateResult extends Allocation {
  amountUsd: number;
  model: string;
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
  executor: `0x${string}`;
  notes: string[];
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
