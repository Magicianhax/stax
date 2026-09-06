// Private beta — the client-safe half of docs/BETA.md: the feature flag and the
// JSON shapes the beta/admin UI and the server share. No server imports here.
//
// Timestamps are unix SECONDS (the app's convention, see lib/autopilot.ts).

/** Flag: `NEXT_PUBLIC_PRIVATE_BETA=true` gates /app and the money routes. Off → nothing gated. */
export function isBetaOn(): boolean {
  const v = process.env.NEXT_PUBLIC_PRIVATE_BETA;
  return v === "true" || v === "1";
}

export type BetaStatus = "none" | "waiting" | "approved" | "blocked";

/** `GET /api/me/access` and the response of `POST /api/beta/join`. */
export interface Access {
  /** The flag is on. */
  beta: boolean;
  /** 'none' = not on the list. */
  status: BetaStatus;
  /** 1-based rank among waiting rows; null unless status is 'waiting'. */
  position: number | null;
  /** How many people are waiting right now. */
  waiting: number;
  refCode: string | null;
  referrals: number;
  /** `${site}/beta?ref=<refCode>` */
  referralUrl: string | null;
  joinedAt: number | null;
}

/** `GET /api/beta/stats` (public, cached 60 s). */
export interface BetaStats {
  waiting: number;
  approved: number;
  total: number;
}

/** The `stats` block of `GET /api/admin/beta`. */
export interface AdminStats extends BetaStats {
  blocked: number;
  /** Sum of referrals credited across the list. */
  referrals: number;
}

export type WaitlistStatus = Exclude<BetaStatus, "none">;

/** One row of `GET /api/admin/beta`. */
export interface AdminRow {
  id: string;
  userId: string | null;
  address: string | null;
  email: string | null;
  status: WaitlistStatus;
  refCode: string;
  referredBy: string | null;
  referrals: number;
  position: number | null;
  source: string | null;
  note: string | null;
  createdAt: number;
  approvedAt: number | null;
}

export interface AdminListResponse {
  rows: AdminRow[];
  /** Opaque keyset cursor for the next page; null on the last page. */
  next: string | null;
  stats: AdminStats;
}

export type AdminAction =
  | { action: "approve" | "block" | "unblock"; ids: string[] }
  | { action: "approveTop"; n: number }
  | { action: "add"; entries: { address?: string; email?: string; note?: string }[] }
  | { action: "note"; id: string; note: string };

export interface AdminActionResponse {
  ok: true;
  changed: number;
  /** `add` only: entries not applied and why (e.g. an address held by another account). */
  skipped?: { address: string | null; email: string | null; reason: string }[];
}

/** The 403 body the money routes return while the flag is on and the caller isn't approved. */
export const BETA_GATE_MESSAGE = "Stax is in private beta. You're on the list.";
