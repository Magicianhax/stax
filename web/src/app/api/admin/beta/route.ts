// /api/admin/beta — the waitlist console API (docs/BETA.md). Privy auth + requireAdmin.
//   GET  ?status=&q=&cursor=&limit=  → { rows: AdminRow[], next, stats }
//   POST { action: 'approve'|'block'|'unblock', ids }
//        { action: 'approveTop', n }
//        { action: 'add', entries: [{ address?, email?, note? }] }
//        { action: 'note', id, note }                              → { ok: true, changed }
// Every action writes a waitlist_events row with actor 'admin:<userId>'.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import type { AdminActionResponse, AdminListResponse } from "@/lib/beta";
import { requireAdmin } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";
import {
  ADMIN_LIST_MAX,
  addEntries,
  approve,
  approveTop,
  block,
  getAdminStats,
  listAdmin,
  setNote,
  unblock,
} from "@/lib/server/waitlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

const Query = z.object({
  status: z.enum(["waiting", "approved", "blocked"]).nullish(),
  q: z.string().trim().max(200).nullish(),
  cursor: z.string().max(400).nullish(),
  limit: z.coerce.number().int().min(1).max(ADMIN_LIST_MAX).default(50),
});

const Ids = z.array(z.string().min(1).max(32)).min(1).max(500);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), ids: Ids }),
  z.object({ action: z.literal("block"), ids: Ids }),
  z.object({ action: z.literal("unblock"), ids: Ids }),
  z.object({ action: z.literal("approveTop"), n: z.number().int().min(1).max(1000) }),
  z.object({
    action: z.literal("add"),
    entries: z
      .array(
        z.object({
          address: z
            .string()
            .trim()
            .refine((a) => isAddress(a), "Invalid address.")
            .optional(),
          email: z.string().trim().email().max(254).optional(),
          note: z.string().trim().max(500).optional(),
        }),
      )
      .min(1)
      .max(500),
  }),
  z.object({ action: z.literal("note"), id: z.string().min(1).max(32), note: z.string().max(500) }),
]);

async function gate(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return { res: unauthorized() };
  const limit = rateLimit(`admin-beta:${user.userId}`, 60, 60_000);
  if (!limit.ok) return { res: tooManyRequests(limit.retryAfter) };
  const denied = await requireAdmin(user);
  if (denied) return { res: denied };
  return { user };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = Query.safeParse({ ...params, status: params.status || undefined });
  if (!parsed.success) return badRequest("Invalid query.");

  try {
    const [{ rows, next }, stats] = await Promise.all([listAdmin(parsed.data), getAdminStats()]);
    const body: AdminListResponse = { rows, next, stats };
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    return serverError("admin-beta", err);
  }
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  const admin = g.user.userId;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    let changed: number;
    switch (body.action) {
      case "approve":
        changed = await approve(body.ids, admin);
        break;
      case "block":
        changed = await block(body.ids, admin);
        break;
      case "unblock":
        changed = await unblock(body.ids, admin);
        break;
      case "approveTop":
        changed = await approveTop(body.n, admin);
        break;
      case "add":
        changed = await addEntries(body.entries, admin);
        break;
      case "note":
        changed = await setNote(body.id, body.note, admin);
        break;
    }
    const res: AdminActionResponse = { ok: true, changed };
    return Response.json(res, { headers: NO_STORE });
  } catch (err) {
    return serverError("admin-beta", err);
  }
}
