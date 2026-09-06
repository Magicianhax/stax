"use client";

// One header for every Receive step: optional back arrow, the title, close.
// Replaces BottomSheet's own title row so sub-flows can go back without
// leaving the sheet. Both buttons are 44px targets.
import { Icon } from "@/components/design";
import { haptic } from "@/lib/haptics";
import s from "./receive.module.css";

export function SheetHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, minHeight: 44 }}>
      {onBack && (
        <button
          type="button"
          onClick={() => { haptic.light(); onBack(); }}
          className={`${s.iconBtn} tap`}
          aria-label="Back"
          style={{ marginLeft: -6 }}
        >
          <Icon name="back" size={20} />
        </button>
      )}
      <h3 className="title-sm" style={{ margin: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </h3>
      <button type="button" onClick={onClose} className={`${s.iconBtn} tap`} aria-label="Close" style={{ marginRight: -6 }}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
