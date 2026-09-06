"use client";

// Dropdown — a labelled select whose options carry a logo (a native <select>
// can't). Combobox trigger + listbox. The list opens IN FLOW under the trigger
// rather than floating: the Receive sheet is a scroll container with a
// transform, so an absolute or fixed menu would be clipped at the sheet's edge.
// Expanding inline lets the sheet grow to fit, and the list caps its own
// height and scrolls internally so every option stays reachable.
//
// Keyboard: ArrowUp/Down move, Home/End jump, Enter/Space pick, Escape closes.
// Focus stays on the trigger (aria-activedescendant). Tap outside closes.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/design";
import { haptic } from "@/lib/haptics";
import s from "./receive.module.css";

export interface DropdownOption {
  /** Stable identity (what `onChange` receives). */
  key: string;
  label: string;
  secondary?: string;
  logo: ReactNode;
}

export function Dropdown({
  label,
  placeholder,
  hint,
  options,
  value,
  onChange,
  disabled = false,
  loading = false,
}: {
  label: string;
  placeholder: string;
  /** Quiet line under the field (e.g. why it is disabled). Hidden while open. */
  hint?: string;
  options: DropdownOption[];
  value: string | null;
  onChange: (key: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedIdx = value === null ? -1 : options.findIndex((o) => o.key === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : undefined;

  const openMenu = () => {
    if (disabled || loading || options.length === 0) return;
    setActive(selectedIdx >= 0 ? selectedIdx : 0);
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    haptic.select();
    onChange(o.key);
    close();
  };

  // Tap/click anywhere outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the keyboard-active option inside the list's own scroll area.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (open) setActive((i) => Math.min(i + 1, last));
        else openMenu();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) setActive((i) => Math.max(i - 1, 0));
        else openMenu();
        break;
      case "Home":
        if (open) { e.preventDefault(); setActive(0); }
        break;
      case "End":
        if (open) { e.preventDefault(); setActive(last); }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) pick(active);
        else openMenu();
        break;
      case "Escape":
        if (open) { e.preventDefault(); close(); }
        break;
      case "Tab":
        if (open) close();
        break;
    }
  };

  return (
    <div ref={rootRef} className={s.dd}>
      <span id={labelId} className={s.ddLabel}>{label}</span>
      {loading ? (
        <div className="skeleton" aria-busy style={{ height: 62, borderRadius: 18 }} />
      ) : (
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={labelId}
          aria-activedescendant={open ? optionId(active) : undefined}
          disabled={disabled}
          className={`${s.option} ${s.ddTrigger}`}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={onKeyDown}
          // A button "clicks" on Space keyup; keydown already handled it.
          onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
        >
          {selected ? selected.logo : <span className={s.ddBlank} aria-hidden />}
          <span className={s.ddText}>
            <span className={`${s.ddPrimary} ${selected ? "" : s.ddPlaceholder}`}>{selected?.label ?? placeholder}</span>
            {selected?.secondary && <span className={s.ddSecondary}>{selected.secondary}</span>}
          </span>
          <Icon name="chevD" size={18} className={s.ddChev} />
        </button>
      )}
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-labelledby={labelId} className={s.ddList}>
          {options.map((o, i) => {
            const isSelected = o.key === value;
            return (
              <li
                key={o.key}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                className={`${s.ddOption} ${i === active ? s.ddActive : ""}`}
                onClick={() => pick(i)}
                onPointerMove={() => { if (i !== active) setActive(i); }}
              >
                {o.logo}
                <span className={s.ddText}>
                  <span className={s.ddPrimary}>{o.label}</span>
                  {o.secondary && <span className={s.ddSecondary}>{o.secondary}</span>}
                </span>
                {isSelected && <Icon name="check" size={18} stroke={2.4} className={s.ddCheck} />}
              </li>
            );
          })}
        </ul>
      )}
      {hint && !open && <span className={s.ddHint}>{hint}</span>}
    </div>
  );
}
