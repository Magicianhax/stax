"use client";

// Floating bar for the current selection. Lives sticky at the bottom of the
// scrolling column; only rendered while something is selected.
import { Icon } from "@/components/design/Icon";
import s from "./admin.module.css";

export interface BulkBarProps {
  count: number;
  busy?: boolean;
  onApprove: () => void;
  onBlock: () => void;
  onClear: () => void;
}

export function BulkBar({ count, busy, onApprove, onBlock, onClear }: BulkBarProps) {
  if (count === 0) return null;
  return (
    <div className={s.bulkHost}>
      <div className={s.bulk} role="toolbar" aria-label="Selected rows">
        <span className={s.bulkCount}>
          {count} selected
        </span>
        <button type="button" className={`btn btn-primary ${s.btnSm} tap`} onClick={onApprove} disabled={busy}>
          <Icon name="check" size={16} stroke={2.4} />
          Approve
        </button>
        <button
          type="button"
          className={`btn btn-ghost ${s.btnSm} tap`}
          onClick={onBlock}
          disabled={busy}
          style={{ color: "var(--neg)" }}
        >
          Block
        </button>
        <button type="button" className={s.iconBtn} onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)">
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
