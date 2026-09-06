"use client";

// Dialog for admin tasks: a centred glass card on desktop, a bottom sheet on
// phones. Same scrim/material as the app's BottomSheet, plus what a desktop
// operator expects: Escape closes, focus moves in on open and back on close.
// Children unmount once the exit transition ends, so a form inside starts
// fresh every time the sheet opens.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/design/Icon";
import s from "./admin.module.css";

export interface AdminSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

type Phase = "closed" | "opening" | "open" | "closing";

export function AdminSheet({ open, onClose, title, children }: AdminSheetProps) {
  const [prevOpen, setPrevOpen] = useState(open);
  const [phase, setPhase] = useState<Phase>(open ? "opening" : "closed");
  if (open !== prevOpen) {
    setPrevOpen(open);
    setPhase(open ? "opening" : "closing");
  }

  const panel = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (phase === "opening") {
      restoreTo.current = document.activeElement as HTMLElement | null;
      const r = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(r);
    }
    if (phase === "open") {
      const first = panel.current?.querySelector<HTMLElement>(
        "input, textarea, select, button:not([data-close])",
      );
      (first ?? panel.current)?.focus();
      return;
    }
    if (phase === "closing") {
      const t = setTimeout(() => setPhase("closed"), 220);
      return () => clearTimeout(t);
    }
    restoreTo.current?.focus?.();
    restoreTo.current = null;
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (phase === "closed") return null;

  return (
    <div className={s.scrim} data-open={phase === "open" ? "true" : "false"} onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={s.sheet}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.sheetHead}>
          <h2 className={s.sheetTitle}>{title}</h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label="Close"
            className={`${s.iconBtn} tap`}
            style={{ background: "var(--surface-2)", margin: "-4px -6px -4px 0" }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
