// One-off import of the Supabase-era autopilot data into Neon.
//   npm run db:import -- scripts/supabase-dump.json
// Dump shape: { autopilots: [...], autopilot_runs: [...] } with the OLD Supabase column names
// (unix-second bigints for created_at / next_run_at / last_run_at / ran_at; runs.created_at
// is a timestamptz string). Every legacy row was Mantle-era → chain = 'mantle'.
// Idempotent: ON CONFLICT DO NOTHING everywhere; run ids are preserved and the sequence is
// bumped past the highest id. Prints the counts it inserted and the totals now in Neon.
import { readFileSync } from "node:fs";
import { count, sql } from "drizzle-orm";
import { autopilotRuns, autopilots, db, pool, users } from "../src/lib/db";

type LegacyAutopilot = {
  user_id: string;
  id: string;
  wallet_id: string;
  owner: string;
  smart_account: string;
  goal: string;
  amount_usd: number | string;
  cadence: string;
  risk_ceiling_bps: number;
  max_per_period_usd: number | string;
  active: boolean;
  created_at: number | string;
  next_run_at: number | string;
  last_run_at?: number | string | null;
  runs: number;
  spent_this_period: number | string;
  chain?: string | null;
};

type LegacyRun = {
  id: number | string;
  user_id: string;
  ran_at: number | string;
  amount_usd: number | string;
  assessed_risk_bps?: number | null;
  status: string;
  reason?: string | null;
  tx_hash?: string | null;
  holdings?: unknown;
  created_at?: string | null;
  chain?: string | null;
};

const seconds = (v: number | string): Date => new Date(Number(v) * 1000);
const money = (v: number | string): string => String(Number(v));

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: npm run db:import -- <dump.json>");
  const dump = JSON.parse(readFileSync(file, "utf8")) as { autopilots: LegacyAutopilot[]; autopilot_runs: LegacyRun[] };
  const aps = dump.autopilots ?? [];
  const runs = dump.autopilot_runs ?? [];
  console.log(`dump: ${aps.length} autopilots, ${runs.length} runs`);

  const userIds = [...new Set([...aps.map((a) => a.user_id), ...runs.map((r) => r.user_id)])];
  const inserted = { users: 0, autopilots: 0, runs: 0 };

  await db.transaction(async (tx) => {
    if (userIds.length) {
      const r = await tx
        .insert(users)
        .values(userIds.map((id) => ({ id })))
        .onConflictDoNothing()
        .returning({ id: users.id });
      inserted.users = r.length;
    }

    for (const a of aps) {
      const r = await tx
        .insert(autopilots)
        .values({
          id: a.id,
          userId: a.user_id,
          chain: "mantle",
          walletId: a.wallet_id,
          owner: a.owner,
          smartAccount: a.smart_account,
          goal: a.goal,
          amountUsd: money(a.amount_usd),
          cadence: a.cadence,
          riskCeilingBps: Number(a.risk_ceiling_bps),
          maxPerPeriodUsd: money(a.max_per_period_usd),
          active: Boolean(a.active),
          createdAt: seconds(a.created_at),
          nextRunAt: seconds(a.next_run_at),
          lastRunAt: a.last_run_at == null ? null : seconds(a.last_run_at),
          runs: Number(a.runs),
          spentThisPeriod: money(a.spent_this_period),
        })
        .onConflictDoNothing()
        .returning({ id: autopilots.id });
      inserted.autopilots += r.length;
    }

    const autopilotIdByUser = new Map(aps.map((a) => [a.user_id, a.id]));
    for (const run of runs) {
      const r = await tx
        .insert(autopilotRuns)
        .values({
          id: Number(run.id),
          autopilotId: autopilotIdByUser.get(run.user_id) ?? null,
          userId: run.user_id,
          chain: "mantle",
          ranAt: seconds(run.ran_at),
          status: run.status,
          amountUsd: money(run.amount_usd),
          assessedRiskBps: run.assessed_risk_bps ?? null,
          reason: run.reason ?? null,
          txHash: run.tx_hash ?? null,
          holdings: run.holdings ?? null,
          ...(run.created_at ? { createdAt: new Date(run.created_at) } : {}),
        })
        .onConflictDoNothing()
        .returning({ id: autopilotRuns.id });
      inserted.runs += r.length;
    }

    // Keep future inserts clear of the preserved ids.
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('autopilot_runs', 'id'), greatest((select coalesce(max(id), 0) from autopilot_runs), 1))`,
    );
  });

  const [[a], [r], [m]] = await Promise.all([
    db.select({ n: count() }).from(autopilots),
    db.select({ n: count() }).from(autopilotRuns),
    db.select({ n: count() }).from(autopilotRuns).where(sql`${autopilotRuns.chain} = 'mantle'`),
  ]);
  console.log(`inserted: ${inserted.users} users, ${inserted.autopilots} autopilots, ${inserted.runs} runs`);
  console.log(`neon totals: ${a.n} autopilots, ${r.n} runs (${m.n} on mantle)`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
