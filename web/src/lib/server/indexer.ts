import "server-only";

// StaxExecutor event indexer — keeps `executor_events` (Postgres) in step with the
// chain so record/activity reads never scan the chain. See docs/INFRA.md.
//
//   syncExecutorEvents(chain)  read the cursor → fetch new logs (Etherscan V2, else
//                              chunked RPC) → upsert → advance the cursor to the last
//                              block scanned (even with zero events).
//
// Called at the top of /api/vera-record, /api/activity and the autopilot cron.
// Guards: at most one sync per chain per 60 s (in-process), one in-flight promise per
// chain (concurrent callers share it), and a failure never reaches a route — it is
// logged and the route serves whatever Postgres already has. Routes pass `maxWaitMs`
// so a long first backfill never stalls a response: the sync keeps running in the
// background and the next request sees its result.
import { eq, sql } from "drizzle-orm";
import type { ChainKey, StaxChain } from "@/lib/chains";
import { db, executorEvents, indexCursors } from "@/lib/db";
import { serverClient } from "@/lib/server/chain";
import { fetchExecutorLogs, type LogSource } from "@/lib/server/executorLogs";

const THROTTLE_MS = 60_000;
const INSERT_BATCH = 500;

export interface SyncResult {
  chain: ChainKey;
  /** "skipped" = throttled or not deployed; "error" = fetch/DB failure (logged). */
  status: "synced" | "skipped" | "error";
  source?: LogSource;
  fromBlock?: number;
  toBlock?: number;
  /** Logs fetched in this pass (already-stored rows are ignored by the upsert). */
  events: number;
  /** Cursor after this pass. */
  cursor: number | null;
}

const lastSyncAt = new Map<ChainKey, number>();
const inflight = new Map<ChainKey, Promise<SyncResult>>();

async function readCursor(chain: ChainKey): Promise<number | null> {
  const [row] = await db.select().from(indexCursors).where(eq(indexCursors.chain, chain)).limit(1);
  return row ? Number(row.lastBlock) : null;
}

async function writeCursor(chain: ChainKey, lastBlock: bigint): Promise<void> {
  const value = Number(lastBlock);
  // Monotonic: two instances syncing at once can never move the cursor backwards.
  await db
    .insert(indexCursors)
    .values({ chain, lastBlock: value })
    .onConflictDoUpdate({
      target: indexCursors.chain,
      set: { lastBlock: sql`greatest(${indexCursors.lastBlock}, ${value})`, updatedAt: sql`now()` },
    });
}

async function runSync(chain: StaxChain): Promise<SyncResult> {
  const cursor = await readCursor(chain.key);
  const fromBlock = cursor === null ? chain.contracts.executorBlock : bigintMax(BigInt(cursor + 1), chain.contracts.executorBlock);
  const latest = await serverClient(chain).getBlockNumber();
  if (fromBlock > latest) return { chain: chain.key, status: "synced", events: 0, cursor };

  const { logs, source, toBlock } = await fetchExecutorLogs(chain, fromBlock, latest);

  for (let i = 0; i < logs.length; i += INSERT_BATCH) {
    const rows = logs.slice(i, i + INSERT_BATCH).map((l) => ({
      chain: chain.key,
      blockNumber: Number(l.blockNumber),
      txHash: l.txHash,
      logIndex: l.logIndex,
      event: l.event,
      planId: l.planId,
      user: l.user,
      data: l.data,
      timestamp: new Date(l.timestamp * 1000),
    }));
    await db.insert(executorEvents).values(rows).onConflictDoNothing();
  }
  await writeCursor(chain.key, toBlock);

  return {
    chain: chain.key,
    status: "synced",
    source,
    fromBlock: Number(fromBlock),
    toBlock: Number(toBlock),
    events: logs.length,
    cursor: Number(toBlock),
  };
}

function bigintMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/**
 * Bring `executor_events` up to date for `chain`. Never throws. With `maxWaitMs`
 * the caller gets back after that long at most; the sync itself carries on.
 */
export async function syncExecutorEvents(chain: StaxChain, opts: { maxWaitMs?: number } = {}): Promise<SyncResult> {
  if (!chain.contracts.deployed) return { chain: chain.key, status: "skipped", events: 0, cursor: null };

  let run = inflight.get(chain.key);
  if (!run) {
    const last = lastSyncAt.get(chain.key) ?? 0;
    if (Date.now() - last < THROTTLE_MS) return { chain: chain.key, status: "skipped", events: 0, cursor: null };
    lastSyncAt.set(chain.key, Date.now());
    run = runSync(chain)
      .catch((err): SyncResult => {
        console.error(`[indexer] sync failed on ${chain.key}:`, err);
        // Let the next caller retry right away rather than waiting out the throttle.
        lastSyncAt.delete(chain.key);
        return { chain: chain.key, status: "error", events: 0, cursor: null };
      })
      .finally(() => inflight.delete(chain.key));
    inflight.set(chain.key, run);
  }

  if (opts.maxWaitMs === undefined) return run;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SyncResult>((resolve) => {
    timer = setTimeout(() => resolve({ chain: chain.key, status: "skipped", events: 0, cursor: null }), opts.maxWaitMs);
  });
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}
