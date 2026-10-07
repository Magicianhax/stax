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
import { waitUntil } from "@vercel/functions";
import { touchUser } from "@/lib/server/users";
import type { PrivyEmbeddedWallet } from "@/lib/server/privyWallets";

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

// users.last_seen_at upkeep: one write per user per 5 minutes per instance,
// off the request's critical path (waitUntil keeps the instance alive for it).
// Routes that INSERT rows referencing users.id still `await touchUser()` themselves.
const TOUCH_EVERY_MS = 5 * 60_000;
const lastTouched = new Map<string, number>();
function touchInBackground(userId: string) {
  const now = Date.now();
  if ((lastTouched.get(userId) ?? 0) + TOUCH_EVERY_MS > now) return;
  lastTouched.set(userId, now);
  waitUntil(
    touchUser(userId).catch((e) => {
      lastTouched.delete(userId);
      console.warn("[auth] touchUser failed:", e instanceof Error ? e.message : e);
    }),
  );
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
    touchInBackground(claims.user_id);
    return { userId: claims.user_id };
  } catch {
    return null;
  }
}

/**
 * Providers whose reported email address is verified BY THE PROVIDER before it
 * reaches us. Google and Apple both refuse to hand over an address the account
 * holder has not proven they control.
 *
 * Everything else is deliberately excluded. Discord, Spotify, TikTok, GitHub,
 * LinkedIn and friends expose a profile `email` that the user can often set
 * without confirming, so trusting it would let someone type a stranger's address
 * into a throwaway profile and become that person here: claiming a gift meant for
 * them, or matching ADMIN_EMAILS and walking into the admin console. This
 * function is the only thing standing between an OAuth profile field and both of
 * those doors.
 */
const EMAIL_TRUSTED_PROVIDERS = new Set(["google_oauth", "apple_oauth"]);

/**
 * The email Privy knows for a user, lowercased, from a source we can trust:
 * an `email` account (Privy only creates one after its own OTP check) or a
 * provider in EMAIL_TRUSTED_PROVIDERS that also carries a verification time.
 * Null when there is none or the lookup fails — callers treat email as
 * best-effort. Used by the waitlist, the admin allowlist and gift claims.
 */
export async function fetchPrivyEmail(userId: string): Promise<string | null> {
  try {
    const user = await privy().users()._get(userId);
    for (const acct of user.linked_accounts) {
      if (acct.type === "email" && acct.address) return acct.address.trim().toLowerCase();
    }
    for (const acct of user.linked_accounts) {
      if (!EMAIL_TRUSTED_PROVIDERS.has(acct.type)) continue;
      const withEmail = acct as { email?: unknown; verified_at?: unknown; latest_verified_at?: unknown };
      const email = typeof withEmail.email === "string" ? withEmail.email.trim() : "";
      const verified =
        typeof withEmail.verified_at === "number" || typeof withEmail.latest_verified_at === "number";
      if (email && verified) return email.toLowerCase();
    }
    return null;
  } catch (e) {
    console.warn("[auth] fetchPrivyEmail failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * The X (Twitter) username Privy knows for a user, lowercased and without its "@".
 * Null when they have no X account linked or the lookup fails.
 *
 * This needs no EMAIL_TRUSTED_PROVIDERS-style guard, and the difference is worth being
 * precise about. That guard exists because several providers hand over a profile `email`
 * the account holder never proved they control, so the address is a claim about a THIRD
 * party. A `twitter_oauth` account's `username` is not a claim about anyone else: X itself
 * returned it for the account that just completed the OAuth handshake, so holding the
 * account and holding the handle are the same fact. We still require `verified_at`, so a
 * half-linked account can never answer for a gift.
 *
 * The honest caveat: X releases and re-issues usernames, so a handle can change hands in a
 * way an email address cannot. A gift addressed to "@name" is claimable by whoever holds
 * "@name" on the day it unlocks. That is exactly why a gift can only be claimed ONCE, and
 * why the giver sees who claimed it: the window is one claim, visible, not an open door.
 */
export async function fetchPrivyXUsername(userId: string): Promise<string | null> {
  try {
    const user = await privy().users()._get(userId);
    for (const acct of user.linked_accounts) {
      if (acct.type !== "twitter_oauth") continue;
      const username = typeof acct.username === "string" ? acct.username.trim() : "";
      if (username && typeof acct.verified_at === "number") {
        return username.replace(/^@+/, "").toLowerCase();
      }
    }
    return null;
  } catch (e) {
    console.warn("[auth] fetchPrivyXUsername failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface PrivyWallet {
  address: string;
  /** embedded = Privy-managed EOA; external = user's own wallet; smart_wallet = Privy smart wallet. */
  kind: "embedded" | "external" | "smart_wallet";
}

/**
 * Every Ethereum wallet linked to the user (embedded, external, Privy smart wallet),
 * lowercased, in Privy's order. Throws when Privy cannot be reached — callers that
 * gate on ownership must not treat "unknown" as "owns nothing".
 */
export async function fetchPrivyWallets(userId: string): Promise<PrivyWallet[]> {
  const user = await privy().users()._get(userId);
  const out: PrivyWallet[] = [];
  for (const acct of user.linked_accounts) {
    if (acct.type === "wallet" && acct.chain_type === "ethereum" && acct.address) {
      out.push({
        address: acct.address.toLowerCase(),
        kind: acct.connector_type === "embedded" ? "embedded" : "external",
      });
    } else if (acct.type === "smart_wallet" && acct.address) {
      out.push({ address: acct.address.toLowerCase(), kind: "smart_wallet" });
    }
  }
  return out;
}

/**
 * The user's own Privy-managed (embedded) Ethereum wallets, with their wallet ids. Autopilot
 * signs server-side for a (walletId, owner) pair, so that pair must come from here, never from
 * the request body. Throws when Privy cannot be reached: "unknown" must not read as "owns it".
 */
export async function fetchPrivyEmbeddedWallets(userId: string): Promise<PrivyEmbeddedWallet[]> {
  const user = await privy().users()._get(userId);
  const out: PrivyEmbeddedWallet[] = [];
  for (const acct of user.linked_accounts) {
    if (acct.type !== "wallet" || acct.chain_type !== "ethereum" || acct.connector_type !== "embedded") continue;
    // Only an embedded wallet carries an id (the one the server signs with).
    const id = "id" in acct ? acct.id : null;
    if (id && acct.address) out.push({ id, address: acct.address });
  }
  return out;
}
