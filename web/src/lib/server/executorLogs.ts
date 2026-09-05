import "server-only";

// Server-side StaxExecutor log scanning, per chain. The browser used to call
// eth_getLogs over the full deploy→latest range directly against the public RPC;
// that broke the moment the range passed the RPC's 10,000-block cap, so Vera's
// record and user activity silently read as zero.
//
// Order of preference (mirrors walletTransfers.ts):
//   1. Etherscan V2 `logs/getLogs` (indexed, no range cap, ETHERSCAN_API_KEY)
//   2. Chunked eth_getLogs over the chain's RPC (keyless fallback, <=9999/chunk)
// Results are cached in-memory (keyed by chain) so bursts never re-fan upstream.
// An undeployed executor (Base before launch) yields empty results, never errors.
import { decodeEventLog, encodeEventTopics, padHex } from "viem";
import type { AbiEvent } from "viem";
import type { StaxChain } from "@/lib/chains/types";
import { serverClient } from "@/lib/server/chain";
import {
  RECOMMENDATION_COMMITTED,
  ALLOCATION_EXECUTED,
  aggregateVeraRecord,
  toActivityRows,
  type RecommendationRow,
  type ExecutionRow,
  type VeraRecord,
  type ActivityRow,
} from "@/lib/onchainHistory";
import { IDENTITY_REGISTRY_ABI } from "@/lib/abis";

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;

// Public-RPC getLogs range cap (rpc.mantle.xyz: "block range greater than 10000 max").
const CHUNK = BigInt(9_999);
const CHUNK_CONCURRENCY = 5;

// ── tiny in-memory TTL cache ──────────────────────────────────────────────────
const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

// ── 1) Etherscan V2 logs (indexed; no block-range cap) ────────────────────────
interface EsLog {
  topics: `0x${string}`[];
  data: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: `0x${string}`;
  timeStamp?: `0x${string}`; // hex unix seconds (Etherscan includes it per log)
}

async function etherscanLogs(chain: StaxChain, event: AbiEvent, user?: `0x${string}`): Promise<EsLog[]> {
  const topic0 = encodeEventTopics({ abi: [event] })[0];
  const all: EsLog[] = [];
  // `user` is topic2 on both executor events (planId is topic1).
  const userFilter = user
    ? `&topic2=${padHex(user.toLowerCase() as `0x${string}`, { size: 32 })}&topic0_2_opr=and`
    : "";
  for (let page = 1; page <= 5; page++) {
    const url =
      `https://api.etherscan.io/v2/api?chainid=${chain.etherscanChainId}&module=logs&action=getLogs` +
      `&address=${chain.contracts.executor}&topic0=${topic0}${userFilter}` +
      `&fromBlock=${chain.contracts.executorBlock}&toBlock=latest&page=${page}&offset=1000&apikey=${ETHERSCAN_KEY}`;
    const res = await fetch(url);
    const json = (await res.json()) as { status: string; message: string; result: EsLog[] | string };
    if (!Array.isArray(json.result)) {
      // "No records found" is a clean empty, anything else is a real error.
      if (typeof json.message === "string" && json.message.toLowerCase().includes("no records")) break;
      throw new Error(typeof json.result === "string" ? json.result : json.message || "etherscan logs error");
    }
    all.push(...json.result);
    if (json.result.length < 1000) break;
  }
  return all;
}

// ── 2) chunked public-RPC fallback (keyless; sequential-ish batches) ──────────
async function chunkedLogs(chain: StaxChain, event: AbiEvent, user?: `0x${string}`) {
  const client = serverClient(chain);
  const latest = await client.getBlockNumber();
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let from = chain.contracts.executorBlock; from <= latest; from += CHUNK + BigInt(1)) {
    const to = from + CHUNK > latest ? latest : from + CHUNK;
    ranges.push({ from, to });
  }
  const out: Awaited<ReturnType<typeof client.getLogs>> = [];
  for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) =>
        client.getLogs({
          address: chain.contracts.executor,
          event,
          args: user ? { user } : undefined,
          fromBlock: r.from,
          toBlock: r.to,
        }),
      ),
    );
    for (const logs of results) out.push(...logs);
  }
  return out;
}

// ── decode + row mapping ──────────────────────────────────────────────────────
type DecodedArgs = Record<string, unknown>;

async function readEvent(chain: StaxChain, event: AbiEvent, user?: `0x${string}`): Promise<
  { args: DecodedArgs; txHash: `0x${string}`; blockNumber: bigint; timestamp?: number }[]
> {
  if (ETHERSCAN_KEY) {
    try {
      const raw = await etherscanLogs(chain, event, user);
      return raw.map((l) => {
        const { args } = decodeEventLog({ abi: [event], data: l.data, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
        const timestamp = l.timeStamp ? Number(BigInt(l.timeStamp)) : undefined;
        return { args: args as DecodedArgs, txHash: l.transactionHash, blockNumber: BigInt(l.blockNumber), timestamp };
      });
    } catch {
      /* fall through to chunked RPC */
    }
  }
  const logs = await chunkedLogs(chain, event, user);
  // getLogs with a runtime AbiEvent loses the decoded-args generic; the logs DO
  // carry decoded args at runtime (viem decodes when `event` is passed).
  return (logs as unknown as { args: DecodedArgs; transactionHash: `0x${string}`; blockNumber: bigint | null }[]).map((l) => ({
    args: l.args,
    txHash: l.transactionHash,
    blockNumber: l.blockNumber ?? BigInt(0),
  }));
}

function usdcToNumber(raw: bigint): number {
  return Number(raw) / 1e6;
}

async function readRecommendationRows(chain: StaxChain, user?: `0x${string}`): Promise<RecommendationRow[]> {
  const rows = await readEvent(chain, RECOMMENDATION_COMMITTED, user);
  return rows.map((r) => ({
    planId: r.args.planId as `0x${string}`,
    user: r.args.user as `0x${string}`,
    riskScore: Number(r.args.riskScore ?? 0),
    txHash: r.txHash,
    blockNumber: r.blockNumber,
    timestamp: r.timestamp,
  }));
}

async function readExecutionRows(chain: StaxChain, user?: `0x${string}`): Promise<ExecutionRow[]> {
  const rows = await readEvent(chain, ALLOCATION_EXECUTED, user);
  return rows.map((r) => ({
    planId: r.args.planId as `0x${string}`,
    user: r.args.user as `0x${string}`,
    usdcSpent: usdcToNumber((r.args.usdcSpent as bigint) ?? BigInt(0)),
    legCount: Number(r.args.legCount ?? 0),
    txHash: r.txHash,
    blockNumber: r.blockNumber,
    timestamp: r.timestamp,
  }));
}

// ── public server API ─────────────────────────────────────────────────────────
/** Vera's track record on `chain` (global, or scoped to `user`). Empty when not deployed. */
export async function getVeraRecordServer(chain: StaxChain, user?: `0x${string}`): Promise<VeraRecord> {
  if (!chain.contracts.deployed) return aggregateVeraRecord([], []);
  return cached(`vera:${chain.key}:${user ?? "global"}`, 60_000, async () => {
    const [recs, execs] = await Promise.all([readRecommendationRows(chain, user), readExecutionRows(chain, user)]);
    return aggregateVeraRecord(recs, execs);
  });
}

/** A user's AI-invest activity on `chain`, newest first. Empty when not deployed. */
export async function getUserActivityServer(chain: StaxChain, user: `0x${string}`): Promise<ActivityRow[]> {
  if (!chain.contracts.deployed) return [];
  return cached(`activity:${chain.key}:${user}`, 30_000, async () => {
    const execs = await readExecutionRows(chain, user);
    return toActivityRows(execs);
  });
}

/** Vera's IdentityRegistry reputation score on `chain` (single eth_call; cached 5 min). */
export async function getReputationServer(chain: StaxChain): Promise<bigint | null> {
  if (!chain.contracts.deployed) return null;
  return cached(`reputation:${chain.key}`, 300_000, async () => {
    try {
      const r = await serverClient(chain).readContract({
        address: chain.contracts.registry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "reputationScore",
        args: [chain.contracts.agentId],
      });
      return r as bigint;
    } catch {
      return null;
    }
  });
}
