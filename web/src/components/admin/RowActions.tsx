"use client";

// Per-row icon actions, 44px each, with native tooltips + aria-labels.
// Which ones show depends on the row's status; the column keeps a fixed width.
import { Ban, Check, MessageSquareText, Undo2 } from "lucide-react";
import type { AdminRow } from "@/hooks/useAdminBeta";
import s from "./admin.module.css";

export interface RowActionsProps {
  row: AdminRow;
  disabled?: boolean;
  onApprove: (row: AdminRow) => void;
  onBlock: (row: AdminRow) => void;
  onUnblock: (row: AdminRow) => void;
  onNote: (row: AdminRow) => void;
}

const glyph = { size: 18, strokeWidth: 2, absoluteStrokeWidth: true, "aria-hidden": true } as const;

export function RowActions({ row, disabled, onApprove, onBlock, onUnblock, onNote }: RowActionsProps) {
  return (
    <div className={s.actions}>
      {row.status !== "approved" && row.status !== "blocked" && (
        <button
          type="button"
          className={`${s.iconBtn} ${s.good}`}
          title="Approve"
          aria-label="Approve"
          disabled={disabled}
          onClick={() => onApprove(row)}
        >
          <Check {...glyph} />
        </button>
      )}
      {row.status !== "blocked" ? (
        <button
          type="button"
          className={`${s.iconBtn} ${s.bad}`}
          title="Block"
          aria-label="Block"
          disabled={disabled}
          onClick={() => onBlock(row)}
        >
          <Ban {...glyph} />
        </button>
      ) : (
        <button
          type="button"
          className={s.iconBtn}
          title="Unblock"
          aria-label="Unblock"
          disabled={disabled}
          onClick={() => onUnblock(row)}
        >
          <Undo2 {...glyph} />
        </button>
      )}
      <button
        type="button"
        className={s.iconBtn}
        title={row.note ? `Note: ${row.note}` : "Add a note"}
        aria-label={row.note ? "Edit note" : "Add a note"}
        disabled={disabled}
        onClick={() => onNote(row)}
      >
        <MessageSquareText {...glyph} />
      </button>
    </div>
  );
}
