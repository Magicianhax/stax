"use client";

// "Approve top N": a number, a live preview of who that is, then confirm.
import { useState } from "react";
import { shortAddress, useDebounced } from "./util";
import { useApproveTopPreview } from "@/hooks/useAdminBeta";
import s from "./admin.module.css";
import { AdminSheet } from "./AdminSheet";

export interface ApproveTopSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (n: number) => Promise<unknown>;
}

export function ApproveTopSheet({
  open,
  onClose,
  onConfirm,
}: ApproveTopSheetProps) {
  return (
    <AdminSheet
      open={open}
      onClose={onClose}
      title="Approve the top of the list"
    >
      <ApproveTopForm onClose={onClose} onConfirm={onConfirm} />
    </AdminSheet>
  );
}

// State lives here so it resets whenever the sheet unmounts.
function ApproveTopForm({
  onClose,
  onConfirm,
}: Omit<ApproveTopSheetProps, "open">) {
  const [raw, setRaw] = useState("10");
  const [busy, setBusy] = useState(false);
  const n = Math.max(0, Math.min(200, Math.floor(Number(raw) || 0)));
  const debounced = useDebounced(n, 250);
  const preview = useApproveTopPreview(debounced, true);

  const rows = preview.data?.rows.slice(0, n) ?? [];
  const count = rows.length;

  const confirm = async () => {
    if (n < 1 || busy) return;
    setBusy(true);
    try {
      await onConfirm(n);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={s.sheetBody}
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <p>
        Approves the highest-ranked people still waiting, by referrals then join
        date.
      </p>
      <div>
        <label className={s.fieldLabel} htmlFor="approve-top-n">
          How many
        </label>
        <div className={`field ${s.field}`}>
          <input
            id="approve-top-n"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>
      </div>

      {n > 0 && (
        <div>
          <div className={s.fieldLabel}>
            {preview.isPending
              ? "Checking who that is…"
              : preview.isError
                ? "Couldn't load the preview."
                : count === 0
                  ? "No one is waiting."
                  : count < n
                    ? `Only ${count} waiting. They'll all be approved.`
                    : `These ${count} will be approved`}
          </div>
          {count > 0 && (
            <div className={s.preview}>
              {rows.map((r) => (
                <div key={r.id} className={s.previewRow}>
                  <span className={s.pos}>{r.position ?? "—"}</span>
                  <span
                    className={r.email ? "" : s.mono}
                    title={r.address ?? undefined}
                  >
                    {r.email ?? shortAddress(r.address) ?? r.userId ?? "—"}
                  </span>
                  <span className={s.code}>
                    {r.referrals} ref{r.referrals === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={s.sheetFoot}>
        <button
          type="button"
          className={`btn btn-ghost ${s.btnSm} tap`}
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={`btn btn-primary ${s.btnSm} tap`}
          disabled={busy || n < 1 || preview.isPending || count === 0}
        >
          {busy ? "Approving…" : `Approve ${Math.min(n, count) || n}`}
        </button>
      </div>
    </form>
  );
}
