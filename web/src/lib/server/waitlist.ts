import "server-only";

// Private-beta waitlist store (Postgres). Contract: docs/BETA.md.
//   joinWaitlist()     idempotent join for a signed-in user (links an admin-added row by an
//                      OWNED address / verified email, honours a referral code once, logs `joined`).
//
// Ownership: a client-submitted address is never trusted. The addresses a user controls come
// from lib/server/ownedAddresses.ts (Privy-linked wallets + their derived SimpleAccounts);
// only those may be stored on, or used to link, a row.
//   getAccess()        the caller's Access — position + referrals computed in SQL.
//   getStats()         public counts.
//   listAdmin()        search + status filter + keyset pagination, sorted by position.
//   approve/block/unblock/approveTop/addEntries/setNote — admin actions, each audited.
//
// Position is never stored. Over waiting rows only:
//   rank() over (order by referrals desc, created_at asc)
// where referrals = count of rows whose referred_by = this row's ref_code and status != 'blocked'.
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { isAddress } from "viem";
import type { Access, AdminRow, AdminStats, BetaStats, WaitlistStatus } from "@/lib/beta";
import { isBetaOn } from "@/lib/beta";
import { db, users, waitlist, waitlistEvents, type WaitlistRow } from "@/lib/db";
import { ownedAddresses, type OwnedAddresses, type OwnedResolver } from "@/lib/server/ownedAddresses";
import { fetchPrivyEmail } from "@/lib/server/privyAuth";
import { hasGiftAddressedTo, lookupHash, privyIdentitiesFor } from "@/lib/server/giftsStore";
import { touchUser } from "@/lib/server/users";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

// ---------- ids + codes ----------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Lowercase + digits with the look-alikes (0/o, 1/l/i) removed — safe to read aloud or retype. */
const REF_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const REF_CODE_LENGTH = 8;
const REF_CODE_RE = /^[a-z0-9]{6,12}$/;

function randomFrom(alphabet: string, length: number): string {
  // Rejection sampling keeps the distribution uniform (256 % alphabet.length != 0).
  const max = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < max) {
        out += alphabet[b % alphabet.length];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export { randomFrom };
export type WaitlistExecutor = Executor;

const newId = () => randomFrom(BASE62, 12);
const newRefCode = () => randomFrom(REF_ALPHABET, REF_CODE_LENGTH);

/** Normalise a user-supplied referral code; null when it can't be a code at all. */
export function normalizeRefCode(ref: string | null | undefined): string | null {
  const v = ref?.trim().toLowerCase() ?? "";
  return REF_CODE_RE.test(v) ? v : null;
}

/** Normalise an address; null when it isn't one. */
export function normalizeAddress(address: string | null | undefined): string | null {
  const v = address?.trim() ?? "";
  return v && isAddress(v) ? v.toLowerCase() : null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const v = email?.trim().toLowerCase() ?? "";
  return v.length >= 3 && v.length <= 254 && v.includes("@") ? v : null;
}

/** Postgres unique_violation. */
function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string } | null;
  if (err?.code !== "23505") return false;
  return constraint ? err.constraint === constraint : true;
}

// ---------- email ----------

/**
 * The user's email: the cached `users.email` when known, else Privy's linked accounts
 * (cached back into `users.email`). Null when neither knows one.
 */
export async function resolveUserEmail(userId: string): Promise<string | null> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.email) return u.email.toLowerCase();
  const email = await fetchPrivyEmail(userId);
  if (email) await touchUser(userId, email);
  return email;
}

// ---------- position SQL ----------

/**
 * Every waitlist row with its referral count and (for waiting rows) its position.
 * Usage: `with ${RANKED_CTE} select ... from ranked`.
 */
const RANKED_CTE = sql`
  counts as (
    select referred_by as ref_code, count(*)::int as referrals
    from waitlist
    where referred_by is not null and status <> 'blocked'
    group by referred_by
  ),
  ranked as (
    select
      w.*,
      coalesce(c.referrals, 0)::int as referrals,
      case when w.status = 'waiting' then
        rank() over (partition by w.status order by coalesce(c.referrals, 0) desc, w.created_at asc)::int
      end as position,
      case w.status when 'waiting' then 0 when 'approved' then 1 else 2 end as sort_key,
      to_char(w.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_iso,
      to_char(w.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as approved_iso
    from waitlist w
    left join counts c on c.ref_code = w.ref_code
  )`;

type RankedRow = {
  id: string;
  user_id: string | null;
  address: string | null;
  email: string | null;
  status: WaitlistStatus;
  ref_code: string;
  referred_by: string | null;
  source: string | null;
  note: string | null;
  referrals: number;
  position: number | null;
  sort_key: number;
  /** Microsecond-exact ISO strings (raw `db.execute` rows don't get drizzle's Date mapping). */
  created_iso: string;
  approved_iso: string | null;
};

const seconds = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.stax.best").replace(/\/+$/, "");
}

export function referralUrlFor(refCode: string): string {
  const beta = (process.env.NEXT_PUBLIC_BETA_URL || "").replace(/\/+$/, "");
  return beta ? `${beta}/?ref=${refCode}` : `${siteUrl()}/beta?ref=${refCode}`;
}

async function countWaiting(ex: Executor): Promise<number> {
  const [row] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(waitlist)
    .where(eq(waitlist.status, "waiting"));
  return row?.n ?? 0;
}

function accessNone(waiting: number): Access {
  return {
    beta: isBetaOn(),
    status: "none",
    position: null,
    waiting,
    refCode: null,
    referrals: 0,
    referralUrl: null,
    joinedAt: null,
  };
}

/** The signed-in user's Access (status 'none' when not on the list). */
export async function getAccess(userId: string): Promise<Access> {
  const res = await db.execute<RankedRow>(sql`with ${RANKED_CTE} select * from ranked where user_id = ${userId} limit 1`);
  const row = res.rows[0];
  const waiting = await countWaiting(db);
  if (!row) return accessNone(waiting);
  return {
    beta: isBetaOn(),
    status: row.status,
    position: row.status === "waiting" ? row.position : null,
    waiting,
    refCode: row.ref_code,
    referrals: row.referrals,
    referralUrl: referralUrlFor(row.ref_code),
    joinedAt: seconds(row.created_iso),
  };
}

/** Status only — the cheap read the money-route guard uses. */
export async function getStatus(userId: string): Promise<WaitlistStatus | "none"> {
  const [row] = await db
    .select({ status: waitlist.status })
    .from(waitlist)
    .where(eq(waitlist.userId, userId))
    .limit(1);
  return (row?.status as WaitlistStatus | undefined) ?? "none";
}

// ---------- join ----------

export type WaitlistAction = "joined" | "approved" | "blocked" | "unblocked" | "note" | "imported" | "invited";

export async function logEvent(
  ex: Executor,
  waitlistId: string,
  actor: string,
  action: WaitlistAction,
  meta?: Record<string, unknown>,
): Promise<void> {
  await ex.insert(waitlistEvents).values({ waitlistId, actor, action, meta: meta ?? null });
}

/** Id of the row that already holds `address` (unique), if any. */
async function addressOwner(ex: Executor, address: string): Promise<string | null> {
  const [row] = await ex.select({ id: waitlist.id }).from(waitlist).where(eq(waitlist.address, address)).limit(1);
  return row?.id ?? null;
}

export interface JoinInput {
  userId: string;
  /** What the client saw; only honoured when it is one of the user's owned addresses. */
  address?: string | null;
  ref?: string | null;
  /** Pass to skip the Privy lookup (tests); undefined → resolveUserEmail(). */
  email?: string | null;
}

/** Injection points for tests; production uses Privy + on-chain derivation. */
export interface WaitlistDeps {
  owned?: OwnedResolver;
}

/**
 * Join (or re-read) the list for a signed-in user. Idempotent: a second call returns the
 * same row.
 *
 * Linking rules (docs/BETA.md, hardened):
 *   1. A row with this user_id → it's theirs; backfill address/email when missing.
 *   2. Else an admin-added row (user_id null) whose address ∈ owned(user) OR whose
 *      lower(email) = the user's Privy email → linked to the user (status kept, so a
 *      pre-approved row lets them straight in; a blocked one keeps them out).
 *   3. Else a new waiting row. `ref` counts only when it names an existing, non-blocked
 *      row that is not one of the joiner's own addresses.
 * The stored address is owned.primary (the embedded wallet's SimpleAccount), else the
 * submitted address if owned, else the first owned address, else null — and only when
 * no other row already holds it.
 */
export async function joinWaitlist(input: JoinInput, deps: WaitlistDeps = {}): Promise<Access> {
  const submitted = normalizeAddress(input.address);
  const ref = normalizeRefCode(input.ref);
  const email = input.email === undefined ? await resolveUserEmail(input.userId) : normalizeEmail(input.email);
  const owned = await (deps.owned ?? ownedAddresses)(input.userId);
  if (submitted && !owned.all.has(submitted)) {
    console.warn(`[waitlist] user ${input.userId} submitted an address they don't own; ignored`);
  }
  const address = owned.primary ?? (submitted && owned.all.has(submitted) ? submitted : null) ?? firstOf(owned.all);
  await touchUser(input.userId, email);

  await db.transaction(async (tx) => {
    // 1. Already on the list?
    const [own] = await tx.select().from(waitlist).where(eq(waitlist.userId, input.userId)).limit(1);
    if (own) {
      await fillIn(tx, own, address, email);
      return;
    }

    // 2. An admin-added row for one of the user's own addresses / their verified email → link it.
    const matches: SQL[] = [];
    if (owned.all.size) matches.push(inArray(waitlist.address, [...owned.all]));
    if (email) matches.push(sql`lower(${waitlist.email}) = ${email}`);
    if (matches.length) {
      const [orphan] = await tx
        .select()
        .from(waitlist)
        .where(and(sql`${waitlist.userId} is null`, sql.join(matches, sql` or `)))
        .orderBy(waitlist.createdAt)
        .limit(1);
      if (orphan) {
        await tx.update(waitlist).set({ userId: input.userId }).where(eq(waitlist.id, orphan.id));
        await fillIn(tx, { ...orphan, userId: input.userId }, address, email);
        await logEvent(tx, orphan.id, "system", "joined", {
          linked: true,
          by: orphan.address && owned.all.has(orphan.address) ? "address" : "email",
          address,
          email,
        });
        return;
      }
    }

    // 3. New row. The referrer must exist, not be blocked, and not be the joiner themselves.
    let referredBy: string | null = null;
    if (ref) {
      const [referrer] = await tx
        .select({ refCode: waitlist.refCode, address: waitlist.address })
        .from(waitlist)
        .where(and(eq(waitlist.refCode, ref), sql`${waitlist.status} <> 'blocked'`))
        .limit(1);
      if (referrer && !(referrer.address && owned.all.has(referrer.address))) referredBy = referrer.refCode;
    }
    // An address already on someone else's row is not ours to claim.
    const freeAddress = address && !(await addressOwner(tx, address)) ? address : null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      const refCode = newRefCode();
      try {
        await tx.insert(waitlist).values({
          id,
          userId: input.userId,
          address: freeAddress,
          email,
          status: "waiting",
          refCode,
          referredBy,
          source: "beta-page",
        });
        await logEvent(tx, id, "system", "joined", { address: freeAddress, email, ref: referredBy });
        return;
      } catch (e) {
        // Collision on our own random id / code: draw again. Anything else propagates.
        if (isUniqueViolation(e, "waitlist_ref_code_key") || isUniqueViolation(e, "waitlist_pkey")) continue;
        throw e;
      }
    }
    throw new Error("waitlist: could not allocate a unique ref code");
  });

  return getAccess(input.userId);
}

const firstOf = (set: Set<string>): string | null => set.values().next().value ?? null;

/** Backfill address / email on an existing row when we now know them and they're free. */
async function fillIn(tx: Tx, row: WaitlistRow, address: string | null, email: string | null): Promise<void> {
  const set: PgUpdateSetSource<typeof waitlist> = {};
  if (address && !row.address && !(await addressOwner(tx, address))) set.address = address;
  if (email && !row.email) set.email = email;
  if (Object.keys(set).length) await tx.update(waitlist).set(set).where(eq(waitlist.id, row.id));
}

/**
 * Let someone in because a gift is waiting for them.
 *
 * Being sent a basket is a stronger signal than joining a queue: somebody spent real
 * money addressed to this person, and making them wait behind a waitlist to collect it
 * is the one moment the gate is actively harmful. So the first time a recipient signs
 * in, they are approved — no invite code, no position, no email from us.
 *
 * Identities come from our own `users` row when we have them and from Privy otherwise,
 * so the usual case is one indexed query. Returns true only when this call is what
 * changed the row, which keeps the audit log honest about why someone was let in.
 */
export async function admitGiftRecipient(userId: string): Promise<boolean> {
  const [me] = await db
    .select({ email: users.email, xUsername: users.xUsername })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const hashes: string[] = [];
  if (me?.email) hashes.push(lookupHash({ kind: "email", email: me.email }));
  if (me?.xUsername) hashes.push(lookupHash({ kind: "x", username: me.xUsername }));
  if (hashes.length === 0) {
    const identities = await privyIdentitiesFor(userId);
    if (identities.email) hashes.push(lookupHash({ kind: "email", email: identities.email }));
    if (identities.username) hashes.push(lookupHash({ kind: "x", username: identities.username }));
  }
  if (!(await hasGiftAddressedTo(hashes))) return false;

  // Never unblock a blocked account: a gift is a welcome, not an appeal.
  const [row] = await db
    .update(waitlist)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(eq(waitlist.userId, userId), eq(waitlist.status, "waiting")))
    .returning({ id: waitlist.id });
  if (!row) return false;
  await logEvent(db, row.id, "system", "approved", { reason: "gift" });
  return true;
}

// ---------- stats ----------

export async function getStats(): Promise<BetaStats> {
  const [row] = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${waitlist.status} = 'waiting')::int`,
      approved: sql<number>`count(*) filter (where ${waitlist.status} = 'approved')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(waitlist);
  return { waiting: row?.waiting ?? 0, approved: row?.approved ?? 0, total: row?.total ?? 0 };
}

export async function getAdminStats(): Promise<AdminStats> {
  const [row] = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${waitlist.status} = 'waiting')::int`,
      approved: sql<number>`count(*) filter (where ${waitlist.status} = 'approved')::int`,
      blocked: sql<number>`count(*) filter (where ${waitlist.status} = 'blocked')::int`,
      total: sql<number>`count(*)::int`,
      referrals: sql<number>`count(*) filter (where ${waitlist.referredBy} is not null and ${waitlist.status} <> 'blocked')::int`,
    })
    .from(waitlist);
  return {
    waiting: row?.waiting ?? 0,
    approved: row?.approved ?? 0,
    blocked: row?.blocked ?? 0,
    total: row?.total ?? 0,
    referrals: row?.referrals ?? 0,
  };
}

// ---------- admin list ----------

export interface ListInput {
  status?: WaitlistStatus | null;
  q?: string | null;
  cursor?: string | null;
  limit?: number;
}

/** Keyset cursor = the sort tuple of the last row on the page. */
interface Cursor {
  s: number; // sort_key
  r: number; // referrals
  c: string; // created_at as a microsecond-exact ISO string (created_iso)
  i: string; // id
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (
      typeof c.s === "number" &&
      typeof c.r === "number" &&
      typeof c.c === "string" &&
      !Number.isNaN(Date.parse(c.c)) &&
      typeof c.i === "string"
    ) {
      return { s: c.s, r: c.r, c: c.c, i: c.i };
    }
  } catch {
    /* malformed → first page */
  }
  return null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

function toAdminRow(r: RankedRow): AdminRow {
  return {
    id: r.id,
    userId: r.user_id,
    address: r.address,
    email: r.email,
    status: r.status,
    refCode: r.ref_code,
    referredBy: r.referred_by,
    referrals: r.referrals,
    position: r.status === "waiting" ? r.position : null,
    source: r.source,
    note: r.note,
    createdAt: seconds(r.created_iso) ?? 0,
    approvedAt: seconds(r.approved_iso),
  };
}

export const ADMIN_LIST_MAX = 200;

/**
 * Rows sorted by position (waiting first by rank, then approved, then blocked; ties by
 * created_at, id), filtered by status and a free-text `q` over email / address / refCode /
 * userId / id. Keyset paginated: pass back `next` as `cursor`.
 */
export async function listAdmin(input: ListInput): Promise<{ rows: AdminRow[]; next: string | null }> {
  const limit = Math.min(Math.max(1, input.limit ?? 50), ADMIN_LIST_MAX);
  const where: SQL[] = [];
  if (input.status) where.push(sql`status = ${input.status}`);
  const q = input.q?.trim().toLowerCase();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      sql`(lower(email) like ${like} or address like ${like} or ref_code like ${like} or lower(user_id) like ${like} or lower(id) like ${like})`,
    );
  }
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    // Row-value comparison walks the exact ORDER BY below (referrals negated so every key ascends).
    where.push(
      sql`(sort_key, -referrals, created_at, id) > (${cursor.s}, ${-cursor.r}, ${cursor.c}::timestamptz, ${cursor.i})`,
    );
  }
  const whereSql = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;
  const res = await db.execute<RankedRow>(sql`
    with ${RANKED_CTE}
    select * from ranked
    ${whereSql}
    order by sort_key asc, referrals desc, created_at asc, id asc
    limit ${limit + 1}`);
  const page = res.rows.slice(0, limit);
  const last = page[page.length - 1];
  const next =
    res.rows.length > limit && last
      ? encodeCursor({ s: last.sort_key, r: last.referrals, c: last.created_iso, i: last.id })
      : null;
  return { rows: page.map(toAdminRow), next };
}

// ---------- admin actions ----------

const adminActor = (adminUserId: string) => `admin:${adminUserId}`;

async function transition(
  ids: string[],
  to: WaitlistStatus,
  action: "approved" | "blocked" | "unblocked",
  adminUserId: string,
): Promise<number> {
  if (!ids.length) return 0;
  return db.transaction(async (tx) => {
    const set: PgUpdateSetSource<typeof waitlist> = { status: to };
    if (to === "approved") set.approvedAt = sql`now()`;
    if (to === "blocked") set.blockedAt = sql`now()`;
    if (action === "unblocked") set.blockedAt = null;
    const guard = action === "unblocked" ? eq(waitlist.status, "blocked") : sql`${waitlist.status} <> ${to}`;
    const changed = await tx
      .update(waitlist)
      .set(set)
      .where(and(inArray(waitlist.id, ids), guard))
      .returning({ id: waitlist.id });
    if (changed.length) {
      await tx
        .insert(waitlistEvents)
        .values(changed.map((r) => ({ waitlistId: r.id, actor: adminActor(adminUserId), action, meta: null })));
    }
    return changed.length;
  });
}

export const approve = (ids: string[], adminUserId: string) => transition(ids, "approved", "approved", adminUserId);
export const block = (ids: string[], adminUserId: string) => transition(ids, "blocked", "blocked", adminUserId);
/** Blocked → waiting (the row keeps its created_at, so its old position is restored). */
export const unblock = (ids: string[], adminUserId: string) => transition(ids, "waiting", "unblocked", adminUserId);

/** Approve the top `n` waiting rows by position. */
export async function approveTop(n: number, adminUserId: string): Promise<number> {
  const take = Math.min(Math.max(0, Math.floor(n)), 1000);
  if (!take) return 0;
  const res = await db.execute<{ id: string }>(sql`
    with ${RANKED_CTE}
    select id from ranked where status = 'waiting'
    order by position asc, created_at asc, id asc
    limit ${take}`);
  return approve(
    res.rows.map((r) => r.id),
    adminUserId,
  );
}

export interface AddEntry {
  address?: string | null;
  email?: string | null;
  note?: string | null;
}

export interface AddSkipped {
  address: string | null;
  email: string | null;
  reason: string;
}

export interface AddResult {
  /** Rows created or newly approved. */
  changed: number;
  /** Entries that were not applied, with why (shown to the admin). */
  skipped: AddSkipped[];
}

/**
 * Admin "add": each entry becomes an approved row (`source: 'admin'`), or approves the row
 * that already holds that address / email.
 *
 * Rules: an existing row with no user is fair game (approved, address/email/note filled in).
 * An existing row that already belongs to a user is approved only when the match is
 * legitimate — the address ∈ that user's owned addresses, or the email equals the row's own
 * (verified-at-join) email; a user-owned row never gets its address/email rewritten. Anything
 * else is skipped and reported, never created (so nobody can be approved through an address
 * they merely typed in). Entries with neither a valid address nor an email are skipped too.
 */
export async function addEntries(entries: AddEntry[], adminUserId: string, deps: WaitlistDeps = {}): Promise<AddResult> {
  const actor = adminActor(adminUserId);
  const owned = deps.owned ?? ownedAddresses;
  const ownedCache = new Map<string, Promise<OwnedAddresses>>();
  const ownedFor = (userId: string) => {
    let p = ownedCache.get(userId);
    if (!p) {
      p = owned(userId);
      ownedCache.set(userId, p);
    }
    return p;
  };
  let changed = 0;
  const skipped: AddSkipped[] = [];
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const address = normalizeAddress(entry.address);
      const email = normalizeEmail(entry.email);
      const note = entry.note?.trim().slice(0, 500) || null;
      if (!address && !email) {
        skipped.push({ address: null, email: null, reason: "no address or email" });
        continue;
      }

      const matches: SQL[] = [];
      if (address) matches.push(eq(waitlist.address, address));
      if (email) matches.push(sql`lower(${waitlist.email}) = ${email}`);
      const [existing] = await tx
        .select()
        .from(waitlist)
        .where(sql.join(matches, sql` or `))
        .orderBy(waitlist.createdAt)
        .limit(1);

      if (existing) {
        const byAddress = Boolean(address && existing.address === address);
        const byEmail = Boolean(email && existing.email?.toLowerCase() === email);
        if (existing.userId) {
          // Someone's row: the match must be genuinely theirs.
          let legit = byEmail; // a user-owned row's email was verified with Privy at join
          if (!legit && byAddress && address) legit = (await ownedFor(existing.userId)).all.has(address);
          if (!legit) {
            skipped.push({ address, email, reason: "held by another account" });
            continue;
          }
        }
        const set: PgUpdateSetSource<typeof waitlist> = {};
        if (existing.status !== "approved") {
          set.status = "approved";
          set.approvedAt = sql`now()`;
          set.blockedAt = null;
        }
        if (!existing.userId) {
          if (address && !existing.address && !(await addressOwner(tx, address))) set.address = address;
          if (email && !existing.email) set.email = email;
        }
        if (note) set.note = note;
        if (Object.keys(set).length) await tx.update(waitlist).set(set).where(eq(waitlist.id, existing.id));
        if (set.status) {
          await logEvent(tx, existing.id, actor, "approved", { via: "add" });
          changed++;
        } else if (note) {
          await logEvent(tx, existing.id, actor, "note", { note });
        }
        continue;
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const id = newId();
        try {
          await tx.insert(waitlist).values({
            id,
            address,
            email,
            status: "approved",
            refCode: newRefCode(),
            source: "admin",
            note,
            approvedAt: sql`now()`,
          });
          await logEvent(tx, id, actor, "imported", { source: "admin", address, email });
          await logEvent(tx, id, actor, "approved", { via: "add" });
          changed++;
          break;
        } catch (e) {
          if (isUniqueViolation(e, "waitlist_ref_code_key") || isUniqueViolation(e, "waitlist_pkey")) continue;
          throw e;
        }
      }
    }
  });
  return { changed, skipped };
}

export async function setNote(id: string, note: string, adminUserId: string): Promise<number> {
  const clean = note.trim().slice(0, 500);
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(waitlist)
      .set({ note: clean || null })
      .where(eq(waitlist.id, id))
      .returning({ id: waitlist.id });
    if (changed.length) await logEvent(tx, id, adminActor(adminUserId), "note", { note: clean || null });
    return changed.length;
  });
}
