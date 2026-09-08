// /api/admin/beta/codes — mint and manage invite codes (docs/BETA.md).
//   GET                                                    → { codes: InviteCode[] }
//   POST { action: 'create', count, maxUses?, label?, expiresInDays? } → { ok, created }
//   POST { action: 'disable', codes }                      → { ok, changed }
//
// Same Privy auth + requireAdmin gate as the waitlist console. Codes are returned
// in the clear here and nowhere else: this endpoint is how an admin reads a code
// they are about to hand over.
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  INVITE_BATCH_MAX,
  INVITE_LABEL_MAX,
  type InviteCreateResponse,
  type InviteDisableResponse,
  type InviteListResponse,
} from "@/lib/beta";
import { requireAdmin } from "@/lib/server/admin";
import { createCodes, disableCodes, listCodes } from "@/lib/server/inviteCodes";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    count: z.number().int().min(1).max(INVITE_BATCH_MAX),
    maxUses: z.number().int().min(1).max(10_000).optional(),
    label: z.string().trim().max(INVITE_LABEL_MAX).optional(),
    expiresInDays: z.number().int().min(1).max(3650).optional(),
  }),
  z.object({ action: z.literal("disable"), codes: z.array(z.string().min(1).max(32)).min(1).max(500) }),
]);

async function gate(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return { res: unauthorized() };
  const limit = await rateLimit(`admin-codes:${user.userId}`, 60, 60_000);
  if (!limit.ok) return { res: tooManyRequests(limit.retryAfter) };
  const denied = await requireAdmin(user);
  if (denied) return { res: denied };
  return { user };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  try {
    const body: InviteListResponse = { codes: await listCodes() };
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    return serverError("admin-codes", err);
  }
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    if (body.action === "create") {
      const created = await createCodes(body, g.user.userId);
      const res: InviteCreateResponse = { ok: true, created };
      return Response.json(res, { headers: NO_STORE });
    }
    const res: InviteDisableResponse = { ok: true, changed: await disableCodes(body.codes) };
    return Response.json(res, { headers: NO_STORE });
  } catch (err) {
    return serverError("admin-codes", err);
  }
}
