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
import type { OwnedAddresses } from "../src/lib/server/ownedAddresses";
import { addEntries, approve, getAccess, getStats, joinWaitlist, listAdmin } from "../src/lib/server/waitlist";

const USER = "smoke-user";
const USER_B = "smoke-user-b";
const ADMIN = "smoke-admin";
const ADDR_A = "0x000000000000000000000000000000000000a11a" as const;
const ADDR_B = "0x000000000000000000000000000000000000b22b" as const;
const USER_C = "smoke-user-c";
const ADDR_C = "0x000000000000000000000000000000000000c33c" as const;
/** A pre-approved admin row's address that NO smoke user owns. */
const ADDR_X = "0x000000000000000000000000000000000000eeee" as const; // lowercase: viem isAddress is checksum-strict
const SMOKE_ADDRS = [ADDR_A, ADDR_B, ADDR_C, ADDR_X].map((a) => a.toLowerCase());

/** Stand-in for Privy + on-chain derivation: each user owns exactly one address. */
const OWNED: Record<string, string> = { [USER]: ADDR_A, [USER_B]: ADDR_B, [USER_C]: ADDR_C };
async function mockOwned(userId: string): Promise<OwnedAddresses> {
  const a = OWNED[userId]?.toLowerCase();
  return { all: new Set(a ? [a] : []), primary: a ?? null };
}
const deps = { owned: mockOwned };
const OWNER = "0x000000000000000000000000000000000000dEaD" as const;
const ACCOUNT = "0x000000000000000000000000000000000000bEEF" as const;

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`smoke: ${msg}`);
}

async function cleanup() {
  await db.delete(autopilotRuns).where(eq(autopilotRuns.userId, USER));
  await deleteAutopilot(USER);
  await db.delete(users).where(eq(users.id, USER));
  await db.delete(waitlist).where(inArray(waitlist.userId, [USER, USER_B, USER_C]));
  await db.delete(waitlist).where(inArray(waitlist.address, SMOKE_ADDRS));
  await db.delete(users).where(inArray(users.id, [USER_B, USER_C, ADMIN]));
}

/** Waitlist: two joins with a referral, positions, approve, access. */
async function waitlistRoundTrip() {
  // A joins (email passed explicitly: no Privy lookup for a fake user id).
  const a = await joinWaitlist({ userId: USER, address: ADDR_A, email: "smoke@example.com" }, deps);
  expect(a.status === "waiting" && a.refCode && a.referralUrl?.endsWith(`/beta?ref=${a.refCode}`), "A joined");
  // Idempotent: a second join keeps the same row / code.
  const aAgain = await joinWaitlist({ userId: USER, address: ADDR_A, email: "smoke@example.com" }, deps);
  expect(aAgain.refCode === a.refCode, "join is idempotent");
  // B joins through A's link (uppercase to prove normalisation).
  const b = await joinWaitlist({ userId: USER_B, address: ADDR_B, ref: a.refCode!.toUpperCase(), email: null }, deps);
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

  // Ownership: a pre-approved admin row for ADDR_X must not be claimable by posting ADDR_X.
  const added = await addEntries([{ address: ADDR_X, note: "vip" }], ADMIN, deps);
  expect(added.changed === 1 && added.skipped.length === 0, `admin add created the orphan row (got ${JSON.stringify(added)})`);
  const c = await joinWaitlist({ userId: USER_C, address: ADDR_X, email: null }, deps);
  expect(c.status === "waiting", `C must not inherit the orphan's approval (got ${c.status})`);
  const [cRow] = await db.select().from(waitlist).where(eq(waitlist.userId, USER_C));
  expect(cRow.address === ADDR_C.toLowerCase(), "C's row carries C's OWNED address, not the submitted one");
  const [orphan] = await db.select().from(waitlist).where(eq(waitlist.address, ADDR_X.toLowerCase()));
  expect(orphan.userId === null && orphan.status === "approved", "orphan row untouched");
  // Admin add for an address held by another account (B's row now carries ADDR_X, which B does not own) is skipped.
  await db.delete(waitlist).where(eq(waitlist.id, orphan.id));
  await db.update(waitlist).set({ address: ADDR_X.toLowerCase() }).where(eq(waitlist.userId, USER_B));
  const held = await addEntries([{ address: ADDR_X }], ADMIN, deps);
  expect(held.changed === 0 && held.skipped[0]?.reason === "held by another account", "add skips a held address");
  expect((await getAccess(USER_B)).status === "waiting", "B not approved through a squatted address");
  // …but an address the row's user really owns is approved through add.
  const ok = await addEntries([{ address: ADDR_C }], ADMIN, deps);
  expect(ok.changed === 1 && (await getAccess(USER_C)).status === "approved", "add approves an owned address");
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
