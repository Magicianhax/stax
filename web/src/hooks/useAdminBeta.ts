"use client";

// Admin console data layer for the private-beta waitlist (docs/BETA.md).
//
//   GET  /api/admin/beta?status=&q=&cursor=&limit=  → { rows, next, stats }
//   POST /api/admin/beta  { action, ... }            → { ok: true, changed }
//   GET  /api/admin/beta/codes                       → { codes }
//   POST /api/admin/beta/codes  { action, ... }      → { ok: true, created | changed }
//
// The list is a keyset-paginated infinite query keyed by (status, q). Row
// mutations (approve / block / unblock / note) patch every cached page
// optimistically, roll back on error and invalidate on settle. approveTop and
// add can't be predicted client-side, so they just invalidate.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { authedFetch } from "@/lib/authedFetch";
import type {
  AdminAction,
  AdminActionResponse,
  AdminListResponse,
  AdminRow,
  AdminStats,
  InviteAdminAction,
  InviteCode,
  InviteCreateResponse,
  InviteDisableResponse,
  InviteListResponse,
  WaitlistStatus,
} from "@/lib/beta";

// Shapes are shared with the server (lib/beta.ts); re-exported for the UI.
export type { AdminAction, AdminActionResponse, AdminListResponse, AdminRow, AdminStats };
export type { InviteCode, InviteCreateResponse, InviteDisableResponse, InviteListResponse };
export type AdminStatus = WaitlistStatus;
export type AdminFilter = "all" | AdminStatus;
export type AdminActionResult = AdminActionResponse;

export class AdminError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const PAGE_SIZE = 50;
const KEY = ["admin-beta"] as const;
const CODES_KEY = ["admin-beta-codes"] as const;

/** Normalise a timestamp (unix seconds per the contract; ms / ISO tolerated) to epoch ms. */
export function toMs(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && v.trim() !== "") return toMs(n);
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (!Number.isFinite(v)) return null;
  return v < 1e12 ? v * 1000 : v;
}

async function readError(res: Response): Promise<AdminError> {
  let message = "Something went wrong. Please try again.";
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // keep the generic message
  }
  return new AdminError(res.status, message);
}

export async function fetchAdminList(params: {
  status?: AdminFilter;
  q?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<AdminListResponse> {
  const sp = new URLSearchParams();
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.cursor) sp.set("cursor", params.cursor);
  sp.set("limit", String(params.limit ?? PAGE_SIZE));
  const res = await authedFetch(`/api/admin/beta?${sp.toString()}`, { cache: "no-store" });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as AdminListResponse;
}

export async function postAdminAction(body: AdminAction): Promise<AdminActionResult> {
  const res = await authedFetch("/api/admin/beta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as AdminActionResult;
}

// ── List ─────────────────────────────────────────────────────────────────────

export function useAdminBetaList(filter: AdminFilter, q: string, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: [...KEY, filter, q],
    queryFn: ({ pageParam }) => fetchAdminList({ status: filter, q, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled,
    staleTime: 15_000,
    retry: (count, err) => !(err instanceof AdminError && err.status < 500) && count < 1,
  });

  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];
  const stats = query.data?.pages[0]?.stats ?? null;
  const forbidden = query.error instanceof AdminError && query.error.status === 403;

  return { ...query, rows, stats, forbidden };
}

/** Preview for the "Approve top N" sheet: the first N waiting rows by position. */
export function useApproveTopPreview(n: number, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, "approve-top-preview", n],
    queryFn: () => fetchAdminList({ status: "waiting", limit: Math.max(1, Math.min(n, 200)) }),
    enabled: enabled && n > 0,
    staleTime: 5_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

type Cache = InfiniteData<AdminListResponse, string | null>;

function patchRows(
  data: Cache | undefined,
  fn: (row: AdminRow) => AdminRow,
  statsFn?: (stats: AdminStats, before: AdminRow[], after: AdminRow[]) => AdminStats,
): Cache | undefined {
  if (!data) return data;
  const before = data.pages.flatMap((p) => p.rows);
  const pages = data.pages.map((p) => ({ ...p, rows: p.rows.map(fn) }));
  if (statsFn && pages[0]) {
    const after = pages.flatMap((p) => p.rows);
    pages[0] = { ...pages[0], stats: statsFn(pages[0].stats, before, after) };
  }
  return { ...data, pages };
}

function countBy(rows: AdminRow[]): Record<AdminStatus, number> {
  const c = { waiting: 0, approved: 0, blocked: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

export function useAdminBetaActions() {
  const qc = useQueryClient();

  const snapshot = () => qc.getQueriesData<Cache>({ queryKey: KEY });
  const restore = (snap: ReturnType<typeof snapshot>) => {
    for (const [key, data] of snap) qc.setQueryData(key, data);
  };
  const settle = () => qc.invalidateQueries({ queryKey: KEY });

  const setStatus = useMutation({
    mutationFn: (vars: { action: "approve" | "block" | "unblock"; ids: string[] }) =>
      postAdminAction(vars),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: KEY });
      const snap = snapshot();
      const ids = new Set(vars.ids);
      const next: AdminStatus =
        vars.action === "approve" ? "approved" : vars.action === "block" ? "blocked" : "waiting";
      const now = Math.floor(Date.now() / 1000);
      qc.setQueriesData<Cache>({ queryKey: KEY }, (data) =>
        patchRows(
          data,
          (row) => {
            if (!ids.has(row.id) || row.status === next) return row;
            return {
              ...row,
              status: next,
              position: next === "waiting" ? row.position : null,
              approvedAt: next === "approved" ? now : row.approvedAt,
            };
          },
          (stats, before, after) => {
            const b = countBy(before);
            const a = countBy(after);
            return {
              ...stats,
              waiting: Math.max(0, stats.waiting + a.waiting - b.waiting),
              approved: Math.max(0, stats.approved + a.approved - b.approved),
              blocked: Math.max(0, stats.blocked + a.blocked - b.blocked),
            };
          },
        ),
      );
      return { snap };
    },
    onError: (_err, _vars, ctx) => ctx && restore(ctx.snap),
    onSettled: settle,
  });

  const setNote = useMutation({
    mutationFn: (vars: { id: string; note: string }) => postAdminAction({ action: "note", ...vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: KEY });
      const snap = snapshot();
      qc.setQueriesData<Cache>({ queryKey: KEY }, (data) =>
        patchRows(data, (row) => (row.id === vars.id ? { ...row, note: vars.note || null } : row)),
      );
      return { snap };
    },
    onError: (_err, _vars, ctx) => ctx && restore(ctx.snap),
    onSettled: settle,
  });

  const approveTop = useMutation({
    mutationFn: (n: number) => postAdminAction({ action: "approveTop", n }),
    onSettled: settle,
  });

  const add = useMutation({
    mutationFn: (entries: { address?: string; email?: string; note?: string }[]) =>
      postAdminAction({ action: "add", entries }),
    onSettled: settle,
  });

  return { setStatus, setNote, approveTop, add };
}

// ── Invite codes ─────────────────────────────────────────────────────────────
// Its own cache key: nothing an admin does to the waitlist changes a code, and
// nothing they do to a code changes a waitlist row until someone redeems it.

export async function fetchInviteCodes(): Promise<InviteListResponse> {
  const res = await authedFetch("/api/admin/beta/codes", { cache: "no-store" });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as InviteListResponse;
}

async function postInviteAction<T>(body: InviteAdminAction): Promise<T> {
  const res = await authedFetch("/api/admin/beta/codes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export function useInviteCodes(enabled = true) {
  const query = useQuery({
    queryKey: CODES_KEY,
    queryFn: fetchInviteCodes,
    enabled,
    staleTime: 15_000,
    retry: (count, err) => !(err instanceof AdminError && err.status < 500) && count < 1,
  });

  const codes = query.data?.codes ?? [];
  const forbidden = query.error instanceof AdminError && query.error.status === 403;

  return { ...query, codes, forbidden };
}

export function useInviteCodeActions() {
  const qc = useQueryClient();
  const settle = () => qc.invalidateQueries({ queryKey: CODES_KEY });

  const create = useMutation({
    mutationFn: (vars: { count: number; maxUses?: number; label?: string; expiresInDays?: number }) =>
      postInviteAction<InviteCreateResponse>({ action: "create", ...vars }),
    onSuccess: settle,
  });

  const disable = useMutation({
    mutationFn: (codes: string[]) => postInviteAction<InviteDisableResponse>({ action: "disable", codes }),
    onSuccess: settle,
  });

  return { create, disable };
}
