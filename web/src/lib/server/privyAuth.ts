import "server-only";

// Server-side Privy session verification. The client attaches its Privy access
// token as `Authorization: Bearer <token>` (see lib/authedFetch.ts); here we
// verify it with the app credentials so sensitive routes only run for a logged-in
// Stax user. Closes the "any unauthenticated caller" hole on /api/allocate,
// /api/invest-plan, and /api/pimlico.
//
// Uses @privy-io/node (the current server SDK). The client builds the app's JWKS
// from its credentials, so no separate verification key is needed.
import { PrivyClient } from "@privy-io/node";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;

let cached: PrivyClient | null = null;
function privy(): PrivyClient {
  if (!APP_ID || !APP_SECRET) {
    throw new Error("Privy server auth is not configured (NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET).");
  }
  if (!cached) cached = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
  return cached;
}

/** True once at module load if the server can verify sessions at all. */
export const PRIVY_AUTH_CONFIGURED = Boolean(APP_ID && APP_SECRET);

export interface AuthedUser {
  userId: string;
}

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

/**
 * Verify the caller's Privy session. Returns the user on success, or null when
 * the token is missing, malformed, expired, or invalid. Never throws on a bad
 * token — callers turn null into a 401.
 */
export async function verifyRequest(req: Request): Promise<AuthedUser | null> {
  const token = bearer(req);
  if (!token) return null;
  try {
    const claims = await privy().utils().auth().verifyAccessToken(token);
    return { userId: claims.user_id };
  } catch {
    return null;
  }
}
