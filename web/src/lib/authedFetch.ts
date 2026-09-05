"use client";

// Same-origin API request helpers.
//
//   authHeader()   -> { Authorization: "Bearer <privy token>" } when signed in, else {}
//   chainHeader()  -> { "x-stax-chain": "base" | "mantle" } — the user's active network
//   authedFetch()  -> fetch() with BOTH headers attached (use this for every /api call)
//
// The chain header is how API routes know which network to act on (see
// lib/server/chain.ts -> chainFromRequest). `getAccessToken` is a standalone
// Privy helper — it returns the current token, refreshing if needed, or null
// when signed out.
import { getAccessToken } from "@privy-io/react-auth";
import { CHAIN_HEADER } from "@/lib/chains";
import { getActiveChainKey } from "@/lib/chains/active";

/** `{ Authorization: "Bearer <token>" }` when signed in, else `{}`. */
export async function authHeader(): Promise<Record<string, string>> {
  try {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** `{ "x-stax-chain": <active chain key> }` — always present. */
export function chainHeader(): Record<string, string> {
  return { [CHAIN_HEADER]: getActiveChainKey() };
}

/**
 * `fetch` for same-origin API routes: attaches the Privy session token (when
 * signed in) and the active-chain header. Caller-supplied headers win.
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries({ ...chainHeader(), ...(await authHeader()) })) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return fetch(input, { ...init, headers });
}
