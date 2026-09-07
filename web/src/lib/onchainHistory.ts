// Reads Vera's REAL track record + a user's REAL activity straight from the
// StaxExecutor event log on a given chain. No off-chain database — the chain IS
// the record, which is exactly Vera's trust claim.
//
// Events (mirror the deployed StaxExecutor):
//   RecommendationCommitted(planId indexed, user indexed, recHash, riskScore, agentId)
//   AllocationExecuted(planId indexed, user indexed, usdcSpent, legCount)
//   LegFilled(planId indexed, tokenOut indexed, usdcIn, received)
//
// Vera's global record = every RecommendationCommitted + AllocationExecuted (she
// is the only advising agent). Per-user history filters by the indexed `user`
// topic. Everything degrades gracefully to a 0-state on empty history, and to an
// empty result when the executor is not deployed on the chain yet.
import type { PublicClient } from "viem";
import { parseAbiItem } from "viem";
import type { StaxChain } from "./chains/types";

export const RECOMMENDATION_COMMITTED = parseAbiItem(
  "event RecommendationCommitted(bytes32 indexed planId, address indexed user, bytes32 recHash, uint16 riskScore, uint256 agentId)",
);
export const ALLOCATION_EXECUTED = parseAbiItem(
  "event AllocationExecuted(bytes32 indexed planId, address indexed user, uint256 usdcSpent, uint256 legCount)",
);

export interface RecommendationRow {
  planId: `0x${string}`;
  user: `0x${string}`;
  riskScore: number; // bps
  txHash: `0x${string}`;
  blockNumber: bigint;
  /** Block time (unix seconds) when the log source provides it (Etherscan does; raw RPC does not). */
  timestamp?: number;
}

export interface ExecutionRow {
  planId: `0x${string}`;
  user: `0x${string}`;
  usdcSpent: number; // dollars (6dp -> number)
  legCount: number;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp?: number;
  /** Holdings the plan bought, from LegFilled (absent when not indexed). */
  symbols?: string[];
  /** Per-holding fills: dollars in and units received (absent when not indexed). */
  legs?: ActivityLeg[];
}

/** One filled leg of a plan: what was bought, for how much. */
export interface ActivityLeg {
  symbol: string;
  /** USDC spent on this leg, dollars. */
  usdcIn: number;
  /** Units received, in the asset's own decimals (shares for stocks). */
  qty: number;
}

export interface VeraRecord {
  totalRecommendations: number;
  totalExecutedUsd: number;
  executedCount: number;
  /** Most-recent recommendations, newest first. */
  recentRecommendations: {
    planId: `0x${string}`;
    riskScore: number;
    /** USDC spent if this plan was also executed, else undefined. */
    usdcSpent?: number;
    txHash: `0x${string}`;
    blockNumber: bigint;
    /** Unix seconds; absent when the source had no block time. */
    timestamp?: number;
    /** Holdings the plan bought (for logo clusters); absent when not indexed. */
    symbols?: string[];
  }[];
}

export interface ActivityRow {
  kind: "invest";
  usdc: number;
  legCount: number;
  txHash: `0x${string}`;
  blockNumber: bigint;
  /** Unix seconds; absent when the source had no block time. */
  timestamp?: number;
  /** Holdings the plan bought (for logo clusters); absent when not indexed. */
  symbols?: string[];
  /** On-chain state; confirmed when absent. */
  status?: "confirmed" | "pending" | "failed";
  /** Per-holding fills (dollars in, units out); absent when not indexed. */
  legs?: ActivityLeg[];
}

function usdcToNumber(raw: bigint): number {
  return Number(raw) / 1e6;
}

/** Read all RecommendationCommitted logs (optionally for one user). */
async function readRecommendations(
  chain: StaxChain,
  client: PublicClient,
  user?: `0x${string}`,
): Promise<RecommendationRow[]> {
  const logs = await client.getLogs({
    address: chain.contracts.executor,
    event: RECOMMENDATION_COMMITTED,
    args: user ? { user } : undefined,
    fromBlock: chain.contracts.executorBlock,
    toBlock: "latest",
  });
  return logs.map((l) => ({
    planId: l.args.planId as `0x${string}`,
    user: l.args.user as `0x${string}`,
    riskScore: Number(l.args.riskScore ?? 0),
    txHash: l.transactionHash as `0x${string}`,
    blockNumber: l.blockNumber ?? BigInt(0),
  }));
}

/** Read all AllocationExecuted logs (optionally for one user). */
async function readExecutions(
  chain: StaxChain,
  client: PublicClient,
  user?: `0x${string}`,
): Promise<ExecutionRow[]> {
  const logs = await client.getLogs({
    address: chain.contracts.executor,
    event: ALLOCATION_EXECUTED,
    args: user ? { user } : undefined,
    fromBlock: chain.contracts.executorBlock,
    toBlock: "latest",
  });
  return logs.map((l) => ({
    planId: l.args.planId as `0x${string}`,
    user: l.args.user as `0x${string}`,
    usdcSpent: usdcToNumber(l.args.usdcSpent ?? BigInt(0)),
    legCount: Number(l.args.legCount ?? 0),
    txHash: l.transactionHash as `0x${string}`,
    blockNumber: l.blockNumber ?? BigInt(0),
  }));
}

/** Pure aggregation: rows -> the VeraRecord shape (shared by client + server). */
export function aggregateVeraRecord(
  recs: RecommendationRow[],
  execs: ExecutionRow[],
): VeraRecord {
  // Map executed USDC by planId (a plan can be committed once and executed once
  // in the same call, sharing planId).
  const spentByPlan = new Map<string, number>();
  const symbolsByPlan = new Map<string, string[]>();
  for (const e of execs) {
    spentByPlan.set(e.planId, (spentByPlan.get(e.planId) ?? 0) + e.usdcSpent);
    if (e.symbols?.length) symbolsByPlan.set(e.planId, e.symbols);
  }

  const totalExecutedUsd = execs.reduce((s, e) => s + e.usdcSpent, 0);

  const recentRecommendations = [...recs]
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .slice(0, 8)
    .map((r) => ({
      planId: r.planId,
      riskScore: r.riskScore,
      usdcSpent: spentByPlan.get(r.planId),
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      timestamp: r.timestamp,
      symbols: symbolsByPlan.get(r.planId),
    }));

  return {
    totalRecommendations: recs.length,
    totalExecutedUsd,
    executedCount: execs.length,
    recentRecommendations,
  };
}

/** Pure mapping: executions -> activity rows, newest first (shared client/server). */
export function toActivityRows(execs: ExecutionRow[]): ActivityRow[] {
  return execs
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .map((e) => ({
      kind: "invest" as const,
      usdc: e.usdcSpent,
      legCount: e.legCount,
      txHash: e.txHash,
      blockNumber: e.blockNumber,
      timestamp: e.timestamp,
      symbols: e.symbols,
      legs: e.legs,
    }));
}

/**
 * Vera's verifiable track record on `chain` (or scoped to `user` if provided).
 * Empty history — or an undeployed executor — yields a clean 0-state, never an error.
 *
 * NOTE: scans the FULL block range in one eth_getLogs — public RPCs cap that
 * range (rpc.mantle.xyz: 10k blocks), so browsers should use /api/vera-record
 * instead (Etherscan-indexed, cached). Kept for tooling/server use.
 */
export async function getVeraRecord(
  chain: StaxChain,
  client: PublicClient,
  user?: `0x${string}`,
): Promise<VeraRecord> {
  if (!chain.contracts.deployed) return aggregateVeraRecord([], []);
  const [recs, execs] = await Promise.all([
    readRecommendations(chain, client, user),
    readExecutions(chain, client, user),
  ]);
  return aggregateVeraRecord(recs, execs);
}

/**
 * A user's Stax on-chain activity on `chain` (AllocationExecuted = AI invests),
 * newest first. Direct manual swaps go to the DEX router (not the executor) and
 * aren't attributable from the executor log, so they're intentionally not listed
 * here — the receipt screen still links a manual buy's own tx directly.
 */
export async function getUserActivity(
  chain: StaxChain,
  client: PublicClient,
  user: `0x${string}`,
): Promise<ActivityRow[]> {
  if (!chain.contracts.deployed) return [];
  const execs = await readExecutions(chain, client, user);
  return toActivityRows(execs);
}
