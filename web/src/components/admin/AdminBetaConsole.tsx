"use client";

// /admin/beta — the waitlist console. Auth gate → stats → controls → table.
// Everything that mutates goes through useAdminBetaActions (optimistic), with a
// toast on success and a revert + toast on failure.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { Icon } from "@/components/design/Icon";
import { useToast } from "@/components/design/Toast";
import { useTheme } from "@/hooks/useTheme";
import {
  useAdminBetaActions,
  useAdminBetaList,
  type AdminFilter,
  type AdminRow,
} from "@/hooks/useAdminBeta";
import { AdminScroll } from "./AdminShell";
import { StatsStrip } from "./StatsStrip";
import { WaitlistTable } from "./WaitlistTable";
import { BulkBar } from "./BulkBar";
import { ApproveTopSheet } from "./ApproveTopSheet";
import { AddAddressesSheet } from "./AddAddressesSheet";
import { NoteSheet } from "./NoteSheet";
import { InviteCodesSheet } from "./InviteCodesSheet";
import { downloadText, errMessage, rowsToCsv, useDebounced } from "./util";
import s from "./admin.module.css";

const TABS: { id: AdminFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "approved", label: "Approved" },
  { id: "blocked", label: "Blocked" },
];

function ThemeButton() {
  const { colorMode, toggle } = useTheme();
  return (
    <button
      type="button"
      className={`${s.iconBtn} tap`}
      onClick={toggle}
      aria-label={colorMode === "dark" ? "Switch to light" : "Switch to dark"}
      title={colorMode === "dark" ? "Light" : "Dark"}
    >
      <Icon name={colorMode === "dark" ? "sun" : "moon"} size={19} />
    </button>
  );
}

function Gate({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className={s.gate}>
      <div className={`card ${s.gateCard}`}>
        <h1 className={s.title} style={{ fontSize: 26, marginBottom: 6 }}>
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

export function AdminBetaConsole() {
  const { ready, authenticated } = usePrivy();
  const { login } = useLogin();

  if (!ready) {
    return <AdminBetaBody enabled={false} />;
  }
  if (!authenticated) {
    return <SignedOutGate onSignIn={() => login()} />;
  }
  return <AdminBetaBody enabled />;
}

export function SignedOutGate({ onSignIn }: { onSignIn: () => void }) {
  return (
    <AdminScroll>
      <Gate title="Sign in to continue">
        <p>This page is for the Stax team.</p>
        <button type="button" className={`btn btn-primary ${s.btnSm} tap`} onClick={onSignIn}>
          Sign in
        </button>
      </Gate>
    </AdminScroll>
  );
}

/** Everything below the auth gate. `enabled=false` renders the loading state. */
export function AdminBetaBody({ enabled }: { enabled: boolean }) {
  const { notify } = useToast();

  const [filter, setFilterState] = useState<AdminFilter>("all");
  const [search, setSearchState] = useState("");
  const q = useDebounced(search.trim(), 300);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const list = useAdminBetaList(filter, q, enabled);
  const { setStatus, setNote, approveTop, add } = useAdminBetaActions();

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [topOpen, setTopOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [noteRow, setNoteRow] = useState<AdminRow | null>(null);

  // Selection only makes sense within one list: changing the filter or the
  // search clears it.
  const setFilter = (f: AdminFilter) => {
    setFilterState(f);
    setSelected(new Set());
  };
  const setSearch = (v: string) => {
    setSearchState(v);
    setSelected(new Set());
  };

  // `/` focuses search from anywhere on the page (unless already typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const markPending = useCallback((ids: string[], on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const changeStatus = useCallback(
    async (action: "approve" | "block" | "unblock", ids: string[]) => {
      if (ids.length === 0) return;
      markPending(ids, true);
      const verb = action === "approve" ? "Approved" : action === "block" ? "Blocked" : "Unblocked";
      try {
        const res = await setStatus.mutateAsync({ action, ids });
        const n = res.changed ?? ids.length;
        notify(`${verb} ${n === 1 ? "1 person" : `${n} people`}`, action === "block" ? "lock" : "check");
        setSelected((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      } catch (err) {
        notify(errMessage(err), "info");
      } finally {
        markPending(ids, false);
      }
    },
    [markPending, notify, setStatus],
  );

  const onNoteConfirm = useCallback(
    async (id: string, note: string) => {
      try {
        await setNote.mutateAsync({ id, note });
        notify(note ? "Note saved" : "Note removed");
      } catch (err) {
        notify(errMessage(err), "info");
        throw err;
      }
    },
    [notify, setNote],
  );

  const onApproveTop = useCallback(
    async (n: number) => {
      try {
        const res = await approveTop.mutateAsync(n);
        notify(`Approved ${res.changed === 1 ? "1 person" : `${res.changed} people`}`);
      } catch (err) {
        notify(errMessage(err), "info");
        throw err;
      }
    },
    [approveTop, notify],
  );

  const onAdd = useCallback(
    async (entries: { address?: string; email?: string; note?: string }[]) => {
      try {
        const res = await add.mutateAsync(entries);
        const skipped = res.skipped?.length ?? 0;
        notify(
          `Added ${res.changed === 1 ? "1 person" : `${res.changed} people`}${skipped ? `, ${skipped} skipped` : ""}`,
          skipped ? "info" : "plus",
        );
        return res;
      } catch (err) {
        notify(errMessage(err), "info");
        throw err;
      }
    },
    [add, notify],
  );

  const exportCsv = () => {
    if (list.rows.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`stax-beta-${filter}${q ? "-search" : ""}-${stamp}.csv`, rowsToCsv(list.rows));
    notify(`Exported ${list.rows.length} row${list.rows.length === 1 ? "" : "s"}`);
  };

  const selectedIds = useMemo(() => [...selected], [selected]);
  const approveSelected = () => void changeStatus("approve", selectedIds);
  const blockSelected = () => void changeStatus("block", selectedIds);

  if (list.forbidden) {
    return (
      <AdminScroll>
        <Gate title="Not for you.">
          <p>This account can&apos;t open the beta list.</p>
        </Gate>
      </AdminScroll>
    );
  }

  const loading = !enabled || (list.isPending && !list.isError);
  const error = list.isError && !list.forbidden ? errMessage(list.error) : null;
  const busy = setStatus.isPending;

  return (
    <>
      <AdminScroll>
        <header className={s.header}>
          <div>
            <h1 className={s.title}>Beta list</h1>
            <p className={s.sub}>Who&apos;s waiting, who&apos;s in. Ordered by referrals, then by join date.</p>
          </div>
          <div className={s.headerActions}>
            <ThemeButton />
            <button
              type="button"
              className={`btn btn-ghost ${s.btnSm} tap`}
              onClick={exportCsv}
              disabled={list.rows.length === 0}
              title="Download the loaded rows as CSV"
            >
              Export CSV
            </button>
            <button type="button" className={`btn btn-ghost ${s.btnSm} tap`} onClick={() => setCodesOpen(true)}>
              <Icon name="gift" size={16} stroke={2.2} />
              Invite codes
            </button>
            <button type="button" className={`btn btn-ghost ${s.btnSm} tap`} onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={16} stroke={2.4} />
              Add people
            </button>
            <button type="button" className={`btn btn-primary ${s.btnSm} tap`} onClick={() => setTopOpen(true)}>
              Approve top…
            </button>
          </div>
        </header>

        <StatsStrip stats={list.stats} />

        <div className={s.controls}>
          <label className={`field ${s.search}`}>
            <Icon name="search" size={18} style={{ color: "var(--ink-3)", flex: "none" }} />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="email, address, code or user id"
              aria-label="Search the list"
              autoComplete="off"
              spellCheck={false}
            />
            {search ? (
              <button
                type="button"
                className={s.iconBtn}
                style={{ width: 34, height: 34, margin: "0 -6px 0 0" }}
                onClick={() => {
                  setSearch("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <Icon name="close" size={16} />
              </button>
            ) : (
              <kbd className={s.kbd} aria-hidden>/</kbd>
            )}
          </label>
          <div className={s.tabs} role="tablist" aria-label="Status">
            {TABS.map((t) => {
              const count = list.stats && t.id !== "all" ? list.stats[t.id] : null;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === t.id}
                  className={s.tab}
                  onClick={() => setFilter(t.id)}
                >
                  {t.label}
                  {count != null && <span className={s.tabCount}>{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <WaitlistTable
          rows={list.rows}
          loading={loading}
          error={error}
          query={q}
          filter={filter}
          selected={selected}
          pending={pending}
          onToggle={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleAll={(ids, on) =>
            setSelected((prev) => {
              const next = new Set(prev);
              for (const id of ids) {
                if (on) next.add(id);
                else next.delete(id);
              }
              return next;
            })
          }
          onRetry={() => void list.refetch()}
          onApproveSelected={approveSelected}
          onClearSelection={() => setSelected(new Set())}
          hasMore={!!list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          onApprove={(row) => void changeStatus("approve", [row.id])}
          onBlock={(row) => void changeStatus("block", [row.id])}
          onUnblock={(row) => void changeStatus("unblock", [row.id])}
          onNote={(row) => setNoteRow(row)}
        />

        <BulkBar
          count={selected.size}
          busy={busy}
          onApprove={approveSelected}
          onBlock={blockSelected}
          onClear={() => setSelected(new Set())}
        />
      </AdminScroll>

      <ApproveTopSheet open={topOpen} onClose={() => setTopOpen(false)} onConfirm={onApproveTop} />
      <AddAddressesSheet open={addOpen} onClose={() => setAddOpen(false)} onConfirm={onAdd} />
      <InviteCodesSheet open={codesOpen} onClose={() => setCodesOpen(false)} />
      <NoteSheet row={noteRow} onClose={() => setNoteRow(null)} onConfirm={onNoteConfirm} />
    </>
  );
}
