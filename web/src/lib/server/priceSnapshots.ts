import "server-only";

// Price snapshots — a write-through history of what /api/prices served, one row
// per asset with a live price, at most every 15 minutes per chain. Fed by the
// prices route (fire-and-forget; never on the response path). Read by nothing yet;
// it exists so basket/portfolio charts can be built from our own record later.
import { and, eq, sql } from "drizzle-orm";
import type { ChainKey, StaxChain } from "@/lib/chains";
import { db, priceSnapshots } from "@/lib/db";
import type { AssetPrice } from "@/lib/prices";

const INTERVAL_MS = 15 * 60_000;

/** Last write per chain (ms). Seeded from the table on cold start so a redeploy can't double-write. */
const lastWritten = new Map<ChainKey, number>();
const seeded = new Map<ChainKey, Promise<void>>();

function seed(chain: ChainKey): Promise<void> {
  let p = seeded.get(chain);
  if (!p) {
    p = db
      .select({ max: sql<string | null>`max(${priceSnapshots.takenAt})` })
      .from(priceSnapshots)
      .where(eq(priceSnapshots.chain, chain))
      .then(([row]) => {
        const at = row?.max ? new Date(row.max).getTime() : 0;
        if (at > (lastWritten.get(chain) ?? 0)) lastWritten.set(chain, at);
      });
    seeded.set(chain, p);
  }
  return p;
}

/**
 * Record `prices` for `chain` unless a snapshot was taken in the last 15 minutes.
 * Never rejects: failures are logged and the next call retries.
 */
export async function recordPriceSnapshots(chain: StaxChain, prices: Record<string, AssetPrice>): Promise<void> {
  try {
    await seed(chain.key);
    const now = Date.now();
    if (now - (lastWritten.get(chain.key) ?? 0) < INTERVAL_MS) return;
    // Claim the slot first so a concurrent burst writes once.
    lastWritten.set(chain.key, now);

    const takenAt = new Date(now);
    const rows = Object.values(prices)
      .filter((p): p is AssetPrice & { priceUsd: number } => typeof p.priceUsd === "number" && Number.isFinite(p.priceUsd))
      .map((p) => ({
        chain: chain.key,
        symbol: p.symbol,
        priceUsd: String(p.priceUsd),
        source: p.source,
        takenAt,
      }));
    if (rows.length === 0) return;
    await db
      .insert(priceSnapshots)
      .values(rows)
      .onConflictDoNothing({ target: [priceSnapshots.chain, priceSnapshots.symbol, priceSnapshots.takenAt] });
  } catch (err) {
    console.error(`[priceSnapshots] write failed on ${chain.key}:`, err);
  }
}

/** Most recent snapshot time for `chain` (unix ms), or null. Exposed for smoke tests/tooling. */
export async function latestSnapshotAt(chain: ChainKey): Promise<number | null> {
  const [row] = await db
    .select({ max: sql<string | null>`max(${priceSnapshots.takenAt})` })
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.chain, chain)));
  return row?.max ? new Date(row.max).getTime() : null;
}
