// Database smoke test — round-trips the autopilot claim path against the real database.
//   npm run db:smoke      (= tsx --conditions=react-server --env-file=.env.local scripts/db-smoke.ts)
// `--conditions=react-server` makes the `server-only` guard a no-op so the app's own
// store module can run outside Next. Everything it creates is deleted at the end.
import { eq, inArray } from "drizzle-orm";
import { autopilotRuns, autopilots, db, pool, users, waitlist } from "../src/lib/db";
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
import { approve, getAccess, getStats, joinWaitlist, listAdmin } from "../src/lib/server/waitlist";

const USER = "smoke-user";
const USER_B = "smoke-user-b";
const ADMIN = "smoke-admin";
const ADDR_A = "0x000000000000000000000000000000000000A11A" as const;
const ADDR_B = "0x000000000000000000000000000000000000B22B" as const;
const OWNER = "0x000000000000000000000000000000000000dEaD" as const;
const ACCOUNT = "0x000000000000000000000000000000000000bEEF" as const;

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`smoke: ${msg}`);
}

async function cleanup() {
  await db.delete(autopilotRuns).where(eq(autopilotRuns.userId, USER));
  await deleteAutopilot(USER);
  await db.delete(users).where(eq(users.id, USER));
  await db.delete(waitlist).where(inArray(waitlist.userId, [USER, USER_B]));
  await db.delete(waitlist).where(inArray(waitlist.address, [ADDR_A.toLowerCase(), ADDR_B.toLowerCase()]));
  await db.delete(users).where(inArray(users.id, [USER_B, ADMIN]));
}

/** Waitlist: two joins with a referral, positions, approve, access. */
async function waitlistRoundTrip() {
  // A joins (email passed explicitly: no Privy lookup for a fake user id).
  const a = await joinWaitlist({ userId: USER, address: ADDR_A, email: "smoke@example.com" });
  expect(a.status === "waiting" && a.refCode && a.referralUrl?.endsWith(`/beta?ref=${a.refCode}`), "A joined");
  // Idempotent: a second join keeps the same row / code.
  const aAgain = await joinWaitlist({ userId: USER, address: ADDR_A, email: "smoke@example.com" });
  expect(aAgain.refCode === a.refCode, "join is idempotent");
  // B joins through A's link (uppercase to prove normalisation).
  const b = await joinWaitlist({ userId: USER_B, address: ADDR_B, ref: a.refCode!.toUpperCase(), email: null });
  expect(b.status === "waiting" && b.referrals === 0, "B joined");
  const [bRow] = await db.select().from(waitlist).where(eq(waitlist.userId, USER_B));
  expect(bRow.referredBy === a.refCode && bRow.address === ADDR_B.toLowerCase(), "B referred by A, address lowercased");
  // A now has one referral and outranks B.
  const a2 = await getAccess(USER);
  const b2 = await getAccess(USER_B);
  expect(a2.referrals === 1, `A referrals = ${a2.referrals}, expected 1`);
  expect(a2.position !== null && b2.position !== null && a2.position < b2.position, "A ranks above B");
  expect(a2.waiting >= 2 && a2.waiting === b2.waiting, "waiting count consistent");
  // Admin list contains both, sorted by position, with a search hit on the ref code.
  const page = await listAdmin({ q: a.refCode, limit: 5 });
  expect(page.rows.length === 1 && page.rows[0].userId === USER && page.rows[0].referrals === 1, "admin search by refCode");
  const all = await listAdmin({ status: "waiting", limit: 200 });
  const ia = all.rows.findIndex((r) => r.userId === USER);
  const ib = all.rows.findIndex((r) => r.userId === USER_B);
  expect(ia >= 0 && ib >= 0 && ia < ib, "admin list ordered by position");
  // Approve A: approved rows have no position; B moves up; stats reflect it.
  const before = await getStats();
  expect((await approve([page.rows[0].id], ADMIN)) === 1, "approve changed 1");
  expect((await approve([page.rows[0].id], ADMIN)) === 0, "approve is idempotent");
  const a3 = await getAccess(USER);
  const b3 = await getAccess(USER_B);
  expect(a3.status === "approved" && a3.position === null, "A approved, no position");
  expect(b3.status === "waiting" && b3.position !== null && b3.position < b2.position!, "B moved up");
  const after = await getStats();
  expect(after.waiting === before.waiting - 1 && after.approved === before.approved + 1, "stats moved");
  const none = await getAccess("smoke-nobody");
  expect(none.status === "none" && none.position === null && none.refCode === null, "unknown user → none");
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

  await waitlistRoundTrip();

  await cleanup();
  expect((await getAutopilot(USER)) === null, "cleanup");
  expect((await getSmartAccount(USER, "base")) === null, "cleanup cascaded to smart_accounts");
  expect((await getAccess(USER)).status === "none", "cleanup removed waitlist rows");
  console.log("OK");
}

main()
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => pool.end());
