"use client";

// The list itself. One table, sorted by position (server order), rows stay in
// a single list across "Load more". Selection lives in the parent so the
// BulkBar and the `a` shortcut can share it.
import { useEffect, useRef } from "react";
import { Icon } from "@/components/design/Icon";
import { shortAddress, timeAgo } from "@/lib/format";
import { toMs, type AdminRow } from "@/hooks/useAdminBeta";
import { RowActions, type RowActionsProps } from "./RowActions";
import s from "./admin.module.css";

export interface WaitlistTableProps extends Omit<RowActionsProps, "row" | "disabled"> {
  rows: AdminRow[];
  loading: boolean;
  error: string | null;
  query: string;
  filter: string;
  selected: Set<string>;
  pending: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], on: boolean) => void;
  onRetry: () => void;
  onApproveSelected: () => void;
  onClearSelection: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

const STATUS_LABEL: Record<AdminRow["status"], string> = {
  waiting: "Waiting",
  approved: "Approved",
  blocked: "Blocked",
};

function joined(v: AdminRow["createdAt"]): { rel: string; abs: string } {
  const ms = toMs(v);
  if (ms == null) return { rel: "—", abs: "" };
  return { rel: timeAgo(Math.floor(ms / 1000)), abs: new Date(ms).toLocaleString("en-US") };
}

export function WaitlistTable(props: WaitlistTableProps) {
  const {
    rows, loading, error, query, filter, selected, pending,
    onToggle, onToggleAll, onRetry, onApproveSelected, onClearSelection,
    hasMore, loadingMore, onLoadMore,
    onApprove, onBlock, onUnblock, onNote,
  } = props;

  const headCheck = useRef<HTMLInputElement | null>(null);
  const ids = rows.map((r) => r.id);
  const selectedHere = ids.filter((id) => selected.has(id)).length;
  const allOn = rows.length > 0 && selectedHere === rows.length;
  const someOn = selectedHere > 0 && !allOn;
  useEffect(() => {
    if (headCheck.current) headCheck.current.indeterminate = someOn;
  }, [someOn]);

  // `a` approves the selection while the table (or something inside it) has focus.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox") return;
    if (e.key === "a" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (selected.size === 0) return;
      e.preventDefault();
      onApproveSelected();
    } else if (e.key === "Escape" && selected.size > 0) {
      e.preventDefault();
      onClearSelection();
    }
  };

  const body = (() => {
    if (loading) {
      return (
        <div aria-busy="true" aria-label="Loading the list">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={s.skelRow}>
              <span className={`skeleton ${s.skel}`} style={{ width: 18, height: 18 }} />
              <span className={`skeleton ${s.skel}`} style={{ width: 28 }} />
              <span className={`skeleton ${s.skel}`} style={{ width: `${46 + ((i * 17) % 40)}%` }} />
              <span className={`skeleton ${s.skel}`} style={{ width: 24, justifySelf: "end" }} />
              <span className={`skeleton ${s.skel}`} style={{ width: 54 }} />
              <span className={`skeleton ${s.skel}`} style={{ width: 74, height: 26, borderRadius: 99 }} />
              <span className={`skeleton ${s.skel}`} style={{ width: 60 }} />
              <span className={`skeleton ${s.skel}`} style={{ width: 100, justifySelf: "end" }} />
            </div>
          ))}
        </div>
      );
    }
    if (error) {
      return (
        <div className={s.state} role="alert">
          <div className={s.stateTitle}>Couldn&apos;t load the list.</div>
          <div>{error}</div>
          <button type="button" className={`btn btn-ghost ${s.btnSm} tap`} onClick={onRetry}>
            Try again
          </button>
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className={s.state}>
          <div className={s.stateTitle}>
            {query ? `No matches for “${query}”.` : filter === "all" ? "No one on the list yet." : `No one ${filter}.`}
          </div>
          <div>
            {query
              ? "Search covers email, address, referral code and user id."
              : "People appear here as they join from the beta page, or add them yourself."}
          </div>
        </div>
      );
    }
    return (
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.colCheck}>
              <label className={s.checkbox}>
                <input
                  ref={headCheck}
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => onToggleAll(ids, e.target.checked)}
                  aria-label={allOn ? "Clear selection" : "Select all loaded rows"}
                />
              </label>
            </th>
            <th className={s.colPos}>#</th>
            <th>Person</th>
            <th className={s.colNum}>Referrals</th>
            <th>Joined</th>
            <th>Status</th>
            <th>Referred by</th>
            <th className={s.colActions}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSel = selected.has(row.id);
            const isPending = pending.has(row.id);
            const when = joined(row.createdAt);
            const person = row.email ?? (row.address ? shortAddress(row.address) : row.userId ?? "—");
            const title = row.address ?? row.userId ?? undefined;
            return (
              <tr
                key={row.id}
                className={`${isSel ? s.selected : ""} ${isPending ? s.pending : ""}`}
                aria-selected={isSel}
              >
                <td className={s.colCheck}>
                  <label className={s.checkbox}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => onToggle(row.id)}
                      aria-label={`Select ${person}`}
                    />
                  </label>
                </td>
                <td className={`${s.colPos} ${s.pos}`}>{row.position ?? <span className={s.quiet}>—</span>}</td>
                <td>
                  <div className={s.person}>
                    <span className={`${s.personMain} ${row.email ? "" : s.mono}`} title={title}>
                      {person}
                      {row.note && (
                        <span className={s.noteMark} title={row.note} aria-label={`Note: ${row.note}`}>
                          <Icon name="info" size={13} stroke={2} />
                        </span>
                      )}
                    </span>
                    <span className={s.code} title="Referral code">{row.refCode}</span>
                  </div>
                </td>
                <td className={s.colNum}>{row.referrals}</td>
                <td>
                  <time title={when.abs} className={s.quiet}>{when.rel}</time>
                </td>
                <td>
                  <span className={`${s.chip} ${s[row.status] ?? ""}`}>{STATUS_LABEL[row.status]}</span>
                </td>
                <td>
                  {row.referredBy ? <span className={s.code}>{row.referredBy}</span> : <span className={s.quiet}>—</span>}
                </td>
                <td className={s.colActions}>
                  <RowActions
                    row={row}
                    disabled={isPending}
                    onApprove={onApprove}
                    onBlock={onBlock}
                    onUnblock={onUnblock}
                    onNote={onNote}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  })();

  return (
    <>
      <div
        className={`card ${s.tableWrap}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Waitlist. Press a to approve the selection."
      >
        {body}
      </div>
      {!loading && !error && rows.length > 0 && (
        <div className={s.footer}>
          <span>
            {rows.length} loaded{selected.size > 0 ? `, ${selected.size} selected` : ""}
          </span>
          {hasMore ? (
            <button type="button" className={`btn btn-ghost ${s.btnSm} tap`} onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : (
            <span>That&apos;s everyone.</span>
          )}
        </div>
      )}
    </>
  );
}
