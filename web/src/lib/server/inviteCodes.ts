import "server-only";

// Invite codes: the way past the queue (docs/BETA.md).
//
// The waitlist orders people by referrals and join date, which is fair and slow.
// A code is the deliberate exception: hand one to a judge, an investor or a
// friend and they are approved the moment they redeem it, wherever they were in
// the line. Everything else about them stays normal — they still have a waitlist
// row, a referral code of their own, and an audit trail.
//
//   createCodes()   mint a batch, each drawn from the unambiguous alphabet
//   listCodes()     newest first, for the admin console
//   disableCodes()  turn codes off without deleting the record of them
//   redeemCode()    the one that matters: join if needed, then approve
//
// Redemption is a single conditional UPDATE on the code row. Two people racing
// on the last use of a code cannot both win, because the `uses < max_uses` test
// and the increment happen in the same statement.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  INVITE_ALPHABET,
  INVITE_BATCH_MAX,
  INVITE_CODE_LENGTH,
  INVITE_LABEL_MAX,
  normalizeInviteCode,
  type Access,
  type InviteCode,
} from "@/lib/beta";
import { db, inviteCodes, waitlist, type InviteCodeRow } from "@/lib/db";
import { getAccess, joinWaitlist, logEvent, randomFrom } from "@/lib/server/waitlist";

const DAY_MS = 86_400_000;

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.stax.best").replace(/\/+$/, "");
}

/** The link to hand over. Landing on the beta page with the code already filled in. */
export function inviteUrlFor(code: string): string {
  const beta = (process.env.NEXT_PUBLIC_BETA_URL || "").replace(/\/+$/, "");
  return beta ? `${beta}/?code=${code}` : `${siteUrl()}/beta?code=${code}`;
}

const seconds = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null);

/** Can this code still let someone in, right now? */
function isLive(row: InviteCodeRow, now = Date.now()): boolean {
  if (row.disabledAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now) return false;
  return row.uses < row.maxUses;
}

function toInvite(row: InviteCodeRow, now = Date.now()): InviteCode {
  return {
    code: row.code,
    label: row.label,
    maxUses: row.maxUses,
    uses: row.uses,
    live: isLive(row, now),
    expiresAt: seconds(row.expiresAt),
    disabledAt: seconds(row.disabledAt),
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    url: inviteUrlFor(row.code),
  };
}

// ---------- admin ----------

export interface CreateCodesInput {
  count: number;
  maxUses?: number;
  label?: string | null;
  expiresInDays?: number | null;
}

/**
 * Mint a batch. Each code is drawn independently and inserted on its own, so one
 * unlucky collision costs a redraw rather than the whole batch.
 */
export async function createCodes(input: CreateCodesInput, adminUserId: string): Promise<InviteCode[]> {
  const count = Math.min(Math.max(1, Math.floor(input.count)), INVITE_BATCH_MAX);
  const maxUses = Math.min(Math.max(1, Math.floor(input.maxUses ?? 1)), 10_000);
  const label = input.label?.trim().slice(0, INVITE_LABEL_MAX) || null;
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0 ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null;

  const made: InviteCodeRow[] = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomFrom(INVITE_ALPHABET, INVITE_CODE_LENGTH);
      const [row] = await db
        .insert(inviteCodes)
        .values({ code, label, maxUses, expiresAt, createdBy: adminUserId })
        .onConflictDoNothing()
        .returning();
      if (row) {
        made.push(row);
        break;
      }
    }
  }
  return made.map((r) => toInvite(r));
}

export async function listCodes(limit = 200): Promise<InviteCode[]> {
  const rows = await db
    .select()
    .from(inviteCodes)
    .orderBy(desc(inviteCodes.createdAt))
    .limit(Math.min(Math.max(1, limit), 500));
  const now = Date.now();
  return rows.map((r) => toInvite(r, now));
}

/** Turn codes off. Already-disabled codes are not counted as changed. */
export async function disableCodes(codes: string[]): Promise<number> {
  const wanted = codes.map((c) => normalizeInviteCode(c)).filter((c): c is string => c !== null);
  if (wanted.length === 0) return 0;
  const rows = await db
    .update(inviteCodes)
    .set({ disabledAt: new Date() })
    .where(and(inArray(inviteCodes.code, wanted), isNull(inviteCodes.disabledAt)))
    .returning({ code: inviteCodes.code });
  return rows.length;
}

// ---------- redeeming ----------

export type RedeemFailure = "bad" | "spent" | "expired";
export type RedeemResult = { ok: true; access: Access } | { ok: false; reason: RedeemFailure };

/**
 * Spend one use of `code` for `userId`.
 *
 * The order matters. The user is put on the list first, because approving a row
 * that does not exist is impossible and joining is idempotent anyway. Then the
 * code is claimed with a conditional update — if that update changes no row the
 * code was already spent between the two statements, and nothing is approved.
 * The reverse order would let a crash in between burn a use for nobody.
 */
export async function redeemCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: "bad" };

  const [existing] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
  if (!existing || existing.disabledAt) return { ok: false, reason: "bad" };
  if (existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (existing.uses >= existing.maxUses) return { ok: false, reason: "spent" };

  // Idempotent: returns the row they already have, or makes one.
  await joinWaitlist({ userId });

  const [row] = await db.select().from(waitlist).where(eq(waitlist.userId, userId)).limit(1);
  if (!row) return { ok: false, reason: "bad" };
  // A blocked account is blocked. A code is a queue jump, not an appeal.
  if (row.status === "blocked") return { ok: false, reason: "bad" };
  if (row.status === "approved") return { ok: true, access: await getAccess(userId) };

  const claimed = await db
    .update(inviteCodes)
    .set({ uses: sql`${inviteCodes.uses} + 1` })
    .where(
      and(
        eq(inviteCodes.code, code),
        isNull(inviteCodes.disabledAt),
        sql`${inviteCodes.uses} < ${inviteCodes.maxUses}`,
        sql`(${inviteCodes.expiresAt} is null or ${inviteCodes.expiresAt} > now())`,
      ),
    )
    .returning({ code: inviteCodes.code });
  if (claimed.length === 0) return { ok: false, reason: "spent" };

  await db
    .update(waitlist)
    .set({ status: "approved", approvedAt: new Date(), inviteCode: code })
    .where(and(eq(waitlist.id, row.id), eq(waitlist.status, "waiting")));
  await logEvent(db, row.id, "system", "invited", { code });

  return { ok: true, access: await getAccess(userId) };
}
