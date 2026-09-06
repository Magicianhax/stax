// Database smoke test — round-trips the autopilot claim path against the real database.
//   npm run db:smoke      (= tsx --conditions=react-server --env-file=.env.local scripts/db-smoke.ts)
// `--conditions=react-server` makes the `server-only` guard a no-op so the app's own
// store module can run outside Next. Everything it creates is deleted at the end.
import { eq } from "drizzle-orm";
import { autopilotRuns, autopilots, db, pool, users } from "../src/lib/db";
import {
  claimDueAutopilots,
  deleteAutopilot,
  getAutopilot,
  listRuns,
  logRun,
  recordRun,
  releaseAutopilot,
  upsertAutopilot,
} from "../src/lib/server/autopilotStore";
import { getSmartAccount, touchUser, upsertSmartAccount } from "../src/lib/server/users";

const USER = "smoke-user";
const OWNER = "0x000000000000000000000000000000000000dEaD" as const;
const ACCOUNT = "0x000000000000000000000000000000000000bEEF" as const;

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`smoke: ${msg}`);
}

async function cleanup() {
  await db.delete(autopilotRuns).where(eq(autopilotRuns.userId, USER));
  await deleteAutopilot(USER);
  await db.delete(users).where(eq(users.id, USER));
}

async function main() {
  await cleanup(); // leftovers from an aborted run
  const now = Math.floor(Date.now() / 1000);

  await touchUser(USER, "smoke@example.com");
  await upsertSmartAccount({ userId: USER, chain: "base", owner: OWNER, address: ACCOUNT });
  const acct = await getSmartAccount(USER, "base");
  expect(acct?.address === ACCOUNT, "smart account round-trip");

  const cfg = await upsertAutopilot({
    id: `ap_${USER}`,
    userId: USER,
    walletId: "smoke-wallet",
    owner: OWNER,
    smartAccount: ACCOUNT,
    chain: "base",
    goal: "smoke test",
    amountUsd: 25,
    cadence: "weekly",
    riskCeilingBps: 6000,
    maxPerPeriodUsd: 50,
    active: true,
    createdAt: now,
    nextRunAt: now - 60, // due one minute ago
    runs: 0,
    spentThisPeriod: 0,
  });
  expect(cfg.nextRunAt === now - 60 && cfg.amountUsd === 25 && cfg.chain === "base", "upsert round-trip");
  expect((await getAutopilot(USER))?.id === cfg.id, "getAutopilot");

  // Claim: exactly our row (the table is otherwise empty or not due).
  const claimed = (await claimDueAutopilots(now)).filter((c) => c.userId === USER);
  expect(claimed.length === 1, `claim returned ${claimed.length} rows, expected 1`);
  // A second claim in the same window must NOT hand it out again.
  const again = (await claimDueAutopilots(now)).filter((c) => c.userId === USER);
  expect(again.length === 0, `re-claim returned ${again.length} rows, expected 0`);
  const [claimedRow] = await db.select().from(autopilots).where(eq(autopilots.id, cfg.id));
  expect(claimedRow.claimedAt instanceof Date, "claimed_at stamped");

  await recordRun(USER, { lastRunAt: now, runs: 1, spentThisPeriod: 25 });
  await logRun({
    userId: USER,
    chain: "base",
    ranAt: now,
    amountUsd: 25,
    assessedRiskBps: 4200,
    status: "success",
    txHash: "0xsmoke",
    holdings: [{ symbol: "AAPLx", weightPct: 100, amountUsd: 25 }],
  });
  const runs = await listRuns(USER);
  expect(runs.length === 1 && runs[0].txHash === "0xsmoke" && runs[0].holdings?.[0].symbol === "AAPLx", "run log");
  const [runRow] = await db.select().from(autopilotRuns).where(eq(autopilotRuns.userId, USER));
  expect(runRow.autopilotId === cfg.id, "run linked to autopilot");

  await releaseAutopilot(cfg.id, now + 604_800);
  const after = await getAutopilot(USER);
  expect(after?.runs === 1 && after.spentThisPeriod === 25 && after.nextRunAt === now + 604_800, "release + accounting");
  const [released] = await db.select().from(autopilots).where(eq(autopilots.id, cfg.id));
  expect(released.claimedAt === null, "claim released");

  await cleanup();
  expect((await getAutopilot(USER)) === null, "cleanup");
  expect((await getSmartAccount(USER, "base")) === null, "cleanup cascaded to smart_accounts");
  console.log("OK");
}

main()
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => pool.end());
