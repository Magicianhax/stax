import "server-only";

// Private-beta guards (docs/BETA.md). Both return a Response to send, or null to proceed:
//   const gate = await requireApproved(user); if (gate) return gate;
//
//   requireAdmin(user)     403 unless user.userId ∈ ADMIN_USER_IDS or the user's Privy
//                          email ∈ ADMIN_EMAILS (comma lists, server-only env).
//   requireApproved(user)  no-op while NEXT_PUBLIC_PRIVATE_BETA is off; otherwise 403
//                          with { error, status } unless the caller's waitlist row is approved.
import { BETA_GATE_MESSAGE, isBetaOn } from "@/lib/beta";
import type { AuthedUser } from "@/lib/server/privyAuth";
import { getStatus, resolveUserEmail } from "@/lib/server/waitlist";

function csv(name: string, lower = false): Set<string> {
  const raw = process.env[name] ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => (lower ? s.trim().toLowerCase() : s.trim()))
      .filter(Boolean),
  );
}

/** True when the user is on either admin allowlist. */
export async function isAdmin(user: AuthedUser): Promise<boolean> {
  if (csv("ADMIN_USER_IDS").has(user.userId)) return true;
  const emails = csv("ADMIN_EMAILS", true);
  if (!emails.size) return false;
  const email = await resolveUserEmail(user.userId);
  return Boolean(email && emails.has(email));
}

export async function requireAdmin(user: AuthedUser): Promise<Response | null> {
  if (await isAdmin(user)) return null;
  return Response.json({ error: "Not for you." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function requireApproved(user: AuthedUser): Promise<Response | null> {
  if (!isBetaOn()) return null;
  const status = await getStatus(user.userId);
  if (status === "approved") return null;
  return Response.json(
    { error: BETA_GATE_MESSAGE, status },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
