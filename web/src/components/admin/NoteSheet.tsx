"use client";

// Edit the admin note on one row.
import { useState } from "react";
import type { AdminRow } from "@/hooks/useAdminBeta";
import { shortAddress } from "./util";
import s from "./admin.module.css";
import { AdminSheet } from "./AdminSheet";

export interface NoteSheetProps {
  row: AdminRow | null;
  onClose: () => void;
  onConfirm: (id: string, note: string) => Promise<unknown>;
}

export function NoteSheet({ row, onClose, onConfirm }: NoteSheetProps) {
  // Keep the last row while the sheet animates out; key the form on the row so
  // it starts from that row's note.
  const [last, setLast] = useState(row);
  if (row && row !== last) setLast(row);
  const current = row ?? last;
  return (
    <AdminSheet open={!!row} onClose={onClose} title="Note">
      {current && (
        <NoteForm
          key={current.id}
          row={current}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      )}
    </AdminSheet>
  );
}

function NoteForm({
  row,
  onClose,
  onConfirm,
}: { row: AdminRow } & Omit<NoteSheetProps, "row">) {
  const [note, setNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);

  const who =
    row.email ?? shortAddress(row.address) ?? row.userId ?? row.refCode;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(row.id, note.trim());
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
        Only admins see this. For <b style={{ color: "var(--ink)" }}>{who}</b>.
      </p>
      <div className={`field ${s.field}`}>
        <textarea
          aria-label="Note"
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth remembering about this person"
          maxLength={500}
        />
      </div>
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
          disabled={busy}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
