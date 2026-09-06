import "server-only";

// StaxExecutor event access, per chain.
//
//   FETCHERS  (used by lib/server/indexer.ts) — pull raw executor logs for a block
//             range. Order of preference (mirrors walletTransfers.ts):
//               1. Etherscan V2 `logs/getLogs` (indexed, ETHERSCAN_API_KEY; carries block time)
//               2. Chunked eth_getLogs over the chain's RPC (keyless; <=9,999 blocks/chunk;
//                  block times fetched lazily and cached per block)
//   READS     (used by /api/vera-record, /api/activity) — query the indexer's copy in
//             Postgres (`executor_events`), never a full deploy→latest getLogs: public
//             RPCs cap that range at 10k blocks, which is how Vera's record used to
//             silently read as zero. Rows map to the shared onchainHistory row types,
//             then through the unchanged aggregateVeraRecord / toActivityRows.
//
// An undeployed executor (Base before launch) yields empty results, never errors.
import { createPublicClient, decodeEventLog, encodeEventTopics, fallback, http, parseAbiItem, type AbiEvent, type PublicClient } from "viem";
import { and, desc, eq } from "drizzle-orm";
import type { ChainKey, StaxChain } from "@/lib/chains/types";
import { db, executorEvents } from "@/lib/db";
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
// Public RPCs rate-limit bursts of getLogs (rpc.mantle.xyz: "rate limit exceeded" at 5-wide).
const CHUNK_CONCURRENCY = 2;
/** Upper bound on RPC chunks per fetch so one sync stays bounded; the cursor resumes next time. */
const MAX_RPC_CHUNKS = 400;
/** Retries per chunk on a rate-limit / transient error, with backoff (ms × 2^n). */
const CHUNK_RETRIES = 4;
const CHUNK_BACKOFF_MS = 600;

/**
 * Keyless RPCs that serve wide `eth_getLogs` ranges, tried after the chain's own
 * RPC (verified 2026-09-06: base-rpc.publicnode.com refuses historical getLogs
 * without a token; rpc.mantle.xyz rate-limits bursts).
 */
const LOG_RPC_FALLBACKS: Record<ChainKey, string[]> = {
  base: ["https://mainnet.base.org"],
  mantle: ["https://mantle-rpc.publicnode.com"],
};
/** Etherscan pages per event per fetch (1000 logs each). */
const MAX_ETHERSCAN_PAGES = 5;

export type ExecutorEventName = "RecommendationCommitted" | "AllocationExecuted" | "LegFilled";

// Not in onchainHistory (no UI reads it yet) but indexed so the record is complete.
const LEG_FILLED = parseAbiItem(
  "event LegFilled(bytes32 indexed planId, address indexed tokenOut, uint256 usdcIn, uint256 received)",
);

const EVENTS: { name: ExecutorEventName; abi: AbiEvent }[] = [
  { name: "RecommendationCommitted", abi: RECOMMENDATION_COMMITTED },
  { name: "AllocationExecuted", abi: ALLOCATION_EXECUTED },
  { name: "LegFilled", abi: LEG_FILLED },
];
const EVENT_ABIS = EVENTS.map((e) => e.abi);
const EVENT_BY_TOPIC = new Map<string, ExecutorEventName>(
  EVENTS.map((e) => [encodeEventTopics({ abi: [e.abi] })[0].toLowerCase(), e.name]),
);

/** One decoded executor log, JSON-safe (bigint args stringified) for the `data` column. */
export interface RawExecutorLog {
  event: ExecutorEventName;
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  /** Block time, unix seconds. */
  timestamp: number;
  planId: `0x${string}` | null;
  /** Lowercased, when the event carries one (LegFilled does not). */
  user: `0x${string}` | null;
  data: Record<string, string | number | boolean | null>;
}

export type LogSource = "etherscan" | "rpc";

export interface FetchedLogs {
  logs: RawExecutorLog[];
  source: LogSource;
  /** The last block actually covered (may be < the requested `toBlock` when capped). */
  toBlock: bigint;
}

// ── tiny in-memory TTL cache ──────────────────────────────────────────────────
const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

// ── decode helpers ────────────────────────────────────────────────────────────
type DecodedArgs = Record<string, unknown>;

function jsonSafe(args: DecodedArgs): RawExecutorLog["data"] {
  const out: RawExecutorLog["data"] = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === "bigint" ? v.toString() : typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : v == null ? null : String(v);
  }
  return out;
}

function toRaw(
  event: ExecutorEventName,
  args: DecodedArgs,
  meta: { txHash: `0x${string}`; logIndex: number; blockNumber: bigint; timestamp: number },
): RawExecutorLog {
  const user = typeof args.user === "string" ? (args.user.toLowerCase() as `0x${string}`) : null;
  return {
    event,
    ...meta,
    txHash: meta.txHash.toLowerCase() as `0x${string}`,
    planId: typeof args.planId === "string" ? (args.planId.toLowerCase() as `0x${string}`) : null,
    user,
    data: jsonSafe(args),
  };
}

// ── 1) Etherscan V2 logs (indexed; carries timeStamp per log) ─────────────────
interface EsLog {
  topics: `0x${string}`[];
  data: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: `0x${string}`;
  logIndex: `0x${string}`;
  timeStamp: `0x${string}`; // hex unix seconds
}

async function etherscanLogs(chain: StaxChain, event: AbiEvent, fromBlock: bigint, toBlock: bigint): Promise<EsLog[]> {
  const topic0 = encodeEventTopics({ abi: [event] })[0];
  const all: EsLog[] = [];
  for (let page = 1; page <= MAX_ETHERSCAN_PAGES; page++) {
    const url =
      `https://api.etherscan.io/v2/api?chainid=${chain.etherscanChainId}&module=logs&action=getLogs` +
      `&address=${chain.contracts.executor}&topic0=${topic0}` +
      `&fromBlock=${fromBlock}&toBlock=${toBlock}&page=${page}&offset=1000&apikey=${ETHERSCAN_KEY}`;
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

async function fetchViaEtherscan(chain: StaxChain, fromBlock: bigint, toBlock: bigint): Promise<FetchedLogs> {
  const perEvent = await Promise.all(EVENTS.map((e) => etherscanLogs(chain, e.abi, fromBlock, toBlock)));
  let logs: RawExecutorLog[] = [];
  let coveredTo = toBlock;
  perEvent.forEach((raw, i) => {
    const { name, abi } = EVENTS[i];
    // A page-capped result may be incomplete at its last block: stop the covered
    // range one block short so the next sync picks the rest up.
    if (raw.length >= MAX_ETHERSCAN_PAGES * 1000) {
      const last = BigInt(raw[raw.length - 1].blockNumber) - BigInt(1);
      if (last < coveredTo) coveredTo = last;
    }
    for (const l of raw) {
      const { args } = decodeEventLog({ abi: [abi], data: l.data, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
      logs.push(
        toRaw(name, args as DecodedArgs, {
          txHash: l.transactionHash,
          logIndex: Number(BigInt(l.logIndex ?? "0x0")),
          blockNumber: BigInt(l.blockNumber),
          timestamp: Number(BigInt(l.timeStamp)),
        }),
      );
    }
  });
  if (coveredTo < toBlock) logs = logs.filter((l) => l.blockNumber <= coveredTo);
  return { logs, source: "etherscan", toBlock: coveredTo };
}

// ── 2) chunked public-RPC fallback (keyless; batched chunks; lazy block times) ─
const blockTimes = new Map<string, number>();
const logClients = new Map<ChainKey, PublicClient>();

/** The chain's RPC first, then keyless fallbacks that accept wide getLogs ranges. */
function logClient(chain: StaxChain): PublicClient {
  let c = logClients.get(chain.key);
  if (!c) {
    const urls = [chain.rpcUrl, ...LOG_RPC_FALLBACKS[chain.key].filter((u) => u !== chain.rpcUrl)];
    c = createPublicClient({
      chain: chain.chain,
      transport: fallback(urls.map((u) => http(u, { retryCount: 1 })), { rank: false }),
    }) as PublicClient;
    logClients.set(chain.key, c);
  }
  return c;
}

async function blockTimestamp(chain: StaxChain, block: bigint): Promise<number> {
  const key = `${chain.key}:${block}`;
  const hit = blockTimes.get(key);
  if (hit !== undefined) return hit;
  const b = await logClient(chain).getBlock({ blockNumber: block });
  const ts = Number(b.timestamp);
  blockTimes.set(key, ts);
  return ts;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= CHUNK_RETRIES) throw err;
      await sleep(CHUNK_BACKOFF_MS * 2 ** attempt++);
    }
  }
}

async function fetchViaRpc(chain: StaxChain, fromBlock: bigint, toBlock: bigint): Promise<FetchedLogs> {
  const client = logClient(chain);
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let from = fromBlock; from <= toBlock && ranges.length < MAX_RPC_CHUNKS; from += CHUNK + BigInt(1)) {
    ranges.push({ from, to: from + CHUNK > toBlock ? toBlock : from + CHUNK });
  }
  const coveredTo = ranges.length ? ranges[ranges.length - 1].to : toBlock;

  type Decoded = { eventName?: string; args?: DecodedArgs; topics: `0x${string}`[]; transactionHash: `0x${string}`; logIndex: number | null; blockNumber: bigint | null };
  const found: Decoded[] = [];
  for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) =>
        withRetry(() => client.getLogs({ address: chain.contracts.executor, events: EVENT_ABIS, fromBlock: r.from, toBlock: r.to })),
      ),
    );
    for (const logs of results) found.push(...(logs as unknown as Decoded[]));
  }

  const logs: RawExecutorLog[] = [];
  for (const l of found) {
    const name = EVENT_BY_TOPIC.get((l.topics[0] ?? "").toLowerCase());
    if (!name || !l.args || l.blockNumber == null) continue;
    logs.push(
      toRaw(name, l.args, {
        txHash: l.transactionHash,
        logIndex: l.logIndex ?? 0,
        blockNumber: l.blockNumber,
        timestamp: await blockTimestamp(chain, l.blockNumber),
      }),
    );
  }
  return { logs, source: "rpc", toBlock: coveredTo };
}

/**
 * Fetch every executor event in [fromBlock, toBlock]. Etherscan when a key is set
 * (falls back to RPC on error), else chunked RPC. The returned `toBlock` is the
 * range actually covered — advance the cursor to that, not the requested end.
 */
export async function fetchExecutorLogs(chain: StaxChain, fromBlock: bigint, toBlock: bigint): Promise<FetchedLogs> {
  if (ETHERSCAN_KEY) {
    try {
      return await fetchViaEtherscan(chain, fromBlock, toBlock);
    } catch (err) {
      console.warn(`[executorLogs] etherscan failed on ${chain.key}, using RPC:`, err instanceof Error ? err.message : err);
    }
  }
  return fetchViaRpc(chain, fromBlock, toBlock);
}

// ── Postgres reads → row types ────────────────────────────────────────────────
type EventRow = typeof executorEvents.$inferSelect;

async function eventRows(chain: StaxChain, event: ExecutorEventName, user?: `0x${string}`): Promise<EventRow[]> {
  const where = [eq(executorEvents.chain, chain.key), eq(executorEvents.event, event)];
  if (user) where.push(eq(executorEvents.user, user.toLowerCase()));
  return db
    .select()
    .from(executorEvents)
    .where(and(...where))
    .orderBy(desc(executorEvents.blockNumber), desc(executorEvents.logIndex));
}

function dataOf(row: EventRow): Record<string, unknown> {
  return row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
}

function unixSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function usdcToNumber(raw: unknown): number {
  try {
    return Number(BigInt(String(raw ?? "0"))) / 1e6;
  } catch {
    return 0;
  }
}

async function readRecommendationRows(chain: StaxChain, user?: `0x${string}`): Promise<RecommendationRow[]> {
  const rows = await eventRows(chain, "RecommendationCommitted", user);
  return rows.map((r) => ({
    planId: (r.planId ?? "0x") as `0x${string}`,
    user: (r.user ?? "0x") as `0x${string}`,
    riskScore: Number(dataOf(r).riskScore ?? 0),
    txHash: r.txHash as `0x${string}`,
    blockNumber: BigInt(r.blockNumber),
    timestamp: unixSeconds(r.timestamp),
  }));
}

async function readExecutionRows(chain: StaxChain, user?: `0x${string}`): Promise<ExecutionRow[]> {
  const rows = await eventRows(chain, "AllocationExecuted", user);
  return rows.map((r) => ({
    planId: (r.planId ?? "0x") as `0x${string}`,
    user: (r.user ?? "0x") as `0x${string}`,
    usdcSpent: usdcToNumber(dataOf(r).usdcSpent),
    legCount: Number(dataOf(r).legCount ?? 0),
    txHash: r.txHash as `0x${string}`,
    blockNumber: BigInt(r.blockNumber),
    timestamp: unixSeconds(r.timestamp),
  }));
}

// ── public server API ─────────────────────────────────────────────────────────
/** Vera's track record on `chain` (global, or scoped to `user`), from the indexed copy. Empty when not deployed. */
export async function getVeraRecordServer(chain: StaxChain, user?: `0x${string}`): Promise<VeraRecord> {
  if (!chain.contracts.deployed) return aggregateVeraRecord([], []);
  const [recs, execs] = await Promise.all([readRecommendationRows(chain, user), readExecutionRows(chain, user)]);
  return aggregateVeraRecord(recs, execs);
}

/** A user's AI-invest activity on `chain`, newest first, from the indexed copy. Empty when not deployed. */
export async function getUserActivityServer(chain: StaxChain, user: `0x${string}`): Promise<ActivityRow[]> {
  if (!chain.contracts.deployed) return [];
  return toActivityRows(await readExecutionRows(chain, user));
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
