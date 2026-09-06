import "server-only";

// Autopilot store — Postgres on Neon via Drizzle (durable source of truth).
//   autopilots      one row per user: the config + run accounting.
//   autopilot_runs  append-only audit log of every run (success/skipped/error).
//
// Scheduling safety: the cron claims due rows with ONE atomic UPDATE … RETURNING
// that stamps `claimed_at` (claimDueAutopilots). A claimed row is invisible to
// other cron invocations for 30 minutes, so two overlapping crons can never run
// the same autopilot twice. When the run finishes (ok or not) the cron calls
// releaseAutopilot(), which clears the claim and advances next_run_at.
// recordRun() only writes run accounting and never touches the schedule.
//
// Time: AutopilotConfig / RunLog carry unix SECONDS; the tables use timestamptz.
// Money: numeric columns come back as strings; Number() them here, once.
import { and, desc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { AutopilotConfig } from "@/lib/autopilot";
import { isChainKey, type ChainKey } from "@/lib/chains";
import { autopilotRuns, autopilots, db, type AutopilotRow, type NewAutopilotRow } from "@/lib/db";

/**
 * Rows written before the multi-chain migration have no `chain`. Stax was Mantle-only
 * then, so a missing value means MANTLE — never the current default (Base), or a
 * legacy user's autopilot would start running against an unfunded Base account.
 */
function chainOf(v: unknown): ChainKey {
  return isChainKey(v) ? v : "mantle";
}

const toSeconds = (d: Date): number => Math.floor(d.getTime() / 1000);
const toDate = (s: number): Date => new Date(s * 1000);

function rowToConfig(r: AutopilotRow): AutopilotConfig {
  return {
    id: r.id,
    userId: r.userId,
    walletId: r.walletId,
    owner: r.owner as `0x${string}`,
    smartAccount: r.smartAccount as `0x${string}`,
    chain: chainOf(r.chain),
    goal: r.goal,
    amountUsd: Number(r.amountUsd),
    cadence: r.cadence as AutopilotConfig["cadence"],
    riskCeilingBps: r.riskCeilingBps,
    maxPerPeriodUsd: Number(r.maxPerPeriodUsd),
    active: r.active,
    createdAt: toSeconds(r.createdAt),
    nextRunAt: toSeconds(r.nextRunAt),
    lastRunAt: r.lastRunAt == null ? undefined : toSeconds(r.lastRunAt),
    runs: r.runs,
    spentThisPeriod: Number(r.spentThisPeriod),
  };
}

function configToRow(c: AutopilotConfig): NewAutopilotRow {
  return {
    id: c.id,
    userId: c.userId,
    walletId: c.walletId,
    owner: c.owner,
    smartAccount: c.smartAccount,
    chain: c.chain,
    goal: c.goal,
    amountUsd: String(c.amountUsd),
    cadence: c.cadence,
    riskCeilingBps: c.riskCeilingBps,
    maxPerPeriodUsd: String(c.maxPerPeriodUsd),
    active: c.active,
    createdAt: toDate(c.createdAt),
    nextRunAt: toDate(c.nextRunAt),
    lastRunAt: c.lastRunAt == null ? null : toDate(c.lastRunAt),
    runs: c.runs,
    spentThisPeriod: String(c.spentThisPeriod),
  };
}

export async function getAutopilot(userId: string): Promise<AutopilotConfig | null> {
  const [row] = await db.select().from(autopilots).where(eq(autopilots.userId, userId)).limit(1);
  return row ? rowToConfig(row) : null;
}

/**
 * Create or replace the user's single autopilot (one per user: `user_id` is unique).
 * Requires the `users` row to exist — callers run touchUser() first. Re-configuring
 * also clears any stale claim so the new schedule takes effect immediately.
 */
export async function upsertAutopilot(cfg: AutopilotConfig): Promise<AutopilotConfig> {
  const row = configToRow(cfg);
  const [saved] = await db
    .insert(autopilots)
    .values(row)
    // Drizzle drops `undefined` from SET: keep the existing id / user_id on conflict.
    .onConflictDoUpdate({
      target: autopilots.userId,
      set: { ...row, id: undefined, userId: undefined, claimedAt: null },
    })
    .returning();
  return rowToConfig(saved);
}

export async function deleteAutopilot(userId: string): Promise<void> {
  await db.delete(autopilots).where(eq(autopilots.userId, userId));
}

/** A claim older than this is considered abandoned (crashed run) and may be re-claimed. */
const CLAIM_TTL = sql`interval '30 minutes'`;

/**
 * Atomically claim every due autopilot: one UPDATE … RETURNING that stamps
 * `claimed_at`, so a row can't be claimed twice while a run is in flight.
 * Due = active AND next_run_at <= now AND (unclaimed OR claim older than 30 min).
 * The caller MUST releaseAutopilot() each returned row when its run ends.
 */
export async function claimDueAutopilots(nowSeconds: number): Promise<AutopilotConfig[]> {
  const now = toDate(nowSeconds);
  const rows = await db
    .update(autopilots)
    .set({ claimedAt: sql`now()` })
    .where(
      and(
        eq(autopilots.active, true),
        lte(autopilots.nextRunAt, now),
        or(isNull(autopilots.claimedAt), lt(autopilots.claimedAt, sql`now() - ${CLAIM_TTL}`)),
      ),
    )
    .returning();
  return rows.map(rowToConfig);
}

/** Release a claim and schedule the next run. Called by the cron on success AND failure. */
export async function releaseAutopilot(id: string, nextRunAt: number): Promise<void> {
  await db.update(autopilots).set({ claimedAt: null, nextRunAt: toDate(nextRunAt) }).where(eq(autopilots.id, id));
}

/** Persist run accounting after a successful run. Never touches next_run_at. */
export async function recordRun(
  userId: string,
  patch: { lastRunAt: number; runs: number; spentThisPeriod: number },
): Promise<void> {
  await db
    .update(autopilots)
    .set({ lastRunAt: toDate(patch.lastRunAt), runs: patch.runs, spentThisPeriod: String(patch.spentThisPeriod) })
    .where(eq(autopilots.userId, userId));
}

export interface RunHolding {
  symbol: string;
  weightPct: number;
  amountUsd: number;
}

export interface RunLog {
  userId: string;
  /** Chain the run executed on. */
  chain: ChainKey;
  ranAt: number;
  amountUsd: number;
  assessedRiskBps?: number;
  status: "success" | "skipped" | "error";
  reason?: string;
  txHash?: string;
  holdings?: RunHolding[];
}

/** Recent runs for a user, newest first (the audit trail shown in the app). */
export async function listRuns(userId: string, limit = 20): Promise<RunLog[]> {
  const rows = await db
    .select()
    .from(autopilotRuns)
    .where(eq(autopilotRuns.userId, userId))
    .orderBy(desc(autopilotRuns.ranAt))
    .limit(limit);
  return rows.map((r) => ({
    userId: r.userId,
    chain: chainOf(r.chain),
    ranAt: toSeconds(r.ranAt),
    amountUsd: Number(r.amountUsd),
    assessedRiskBps: r.assessedRiskBps ?? undefined,
    status: r.status as RunLog["status"],
    reason: r.reason ?? undefined,
    txHash: r.txHash ?? undefined,
    holdings: Array.isArray(r.holdings) ? (r.holdings as RunHolding[]) : undefined,
  }));
}

/** Append to the audit log. A logging failure must never break a run. */
export async function logRun(entry: RunLog): Promise<void> {
  try {
    await db.insert(autopilotRuns).values({
      // Link to the user's autopilot if it still exists (FK is ON DELETE SET NULL).
      autopilotId: sql`(select ${autopilots.id} from ${autopilots} where ${autopilots.userId} = ${entry.userId} limit 1)`,
      userId: entry.userId,
      chain: entry.chain,
      ranAt: toDate(entry.ranAt),
      amountUsd: String(entry.amountUsd),
      assessedRiskBps: entry.assessedRiskBps ?? null,
      status: entry.status,
      reason: entry.reason ?? null,
      txHash: entry.txHash ?? null,
      holdings: entry.holdings ?? null,
    });
  } catch (e) {
    console.error("[autopilot] logRun failed:", e instanceof Error ? e.message : e);
  }
}
