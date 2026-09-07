"use client";

// Keypad — the in-app number pad for money. Every screen that takes an amount
// uses this pair, so entering $25 feels the same wherever you do it:
//
//   <AmountInput {...pad.field} aria-label="Amount to buy in dollars" />
//   <Keypad {...pad.keypad} presets={[25, 50, 100]} footer={<button …/>} />
//
// The rules (leading zero, one point, decimal cap, max refusal) live in
// hooks/useAmountKeypad.ts and are shared by the keys and the hardware keyboard,
// so there is exactly one definition of what a legal amount is.
//
// Feel (Apple's fluid-interface rules, translated):
//   • feedback lands on pointer-DOWN — an immediate 0.93 scale on the strong
//     ease-out over 90 ms, plus haptic.light(); the commit happens on release,
//     so sliding off a key cancels it
//   • release springs back over 300 ms on --ease-soft, the one curve in this
//     design system with overshoot, because letting go of a key is physical
//   • both halves are CSS transitions on `transform` only, so a fast re-press
//     catches the key mid-flight and animates from where it actually is
//   • prefers-reduced-motion swaps the travel for a background tint — gentler
//     feedback, not no feedback
//
// The OS keyboard never appears: the amount is a real, focusable <input> that
// is `readOnly` with `inputMode="none"`. Screen readers still announce it and a
// hardware keyboard still types into it (see onKeyDown), but neither iOS nor
// Android raises a software keyboard for a read-only field.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import css from "./keypad.module.css";
import { haptic } from "@/lib/haptics";
import {
  applyKey,
  exceedsMax,
  toAmountString,
  type AmountRules,
  type KeypadKey,
} from "@/hooks/useAmountKeypad";

/** How long a backspace has to be held before it clears the whole amount. */
export const CLEAR_HOLD_MS = 500;

/** Space kept clear under the amount when the pad opens, so the sub-line and
 *  the "more than your cash" note stay in view with the keys up. */
const CLEARANCE = 86;

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const ROWS: KeypadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

function labelFor(key: KeypadKey): string {
  if (key === "back") return "delete";
  if (key === ".") return "decimal point";
  return WORDS[Number(key)];
}

// ── shared key handling ──────────────────────────────────────────────────────

interface Controlled extends AmountRules {
  value: string;
  onChange: (next: string) => void;
  /** Called when the rules refused the press (over `max`, second point, …). */
  onRefused?: () => void;
}

/** Apply one key and report whether it was accepted, with the matching haptic. */
function press(key: KeypadKey, { value, onChange, onRefused, max, decimals }: Controlled): boolean {
  const next = applyKey(value, key, { max, decimals });
  if (next === value) {
    // A refusal is information: the amount did not move and the person deserves
    // to know why, so it gets its own haptic and lets the screen say the reason.
    if (key !== "back" && key !== "clear") {
      haptic.warning();
      onRefused?.();
    }
    return false;
  }
  onChange(next);
  return true;
}

/**
 * Hardware-keyboard support, shared by the amount field and the pad itself:
 * digits, the decimal point, Backspace/Delete, and Escape to clear. Returns
 * true when the event was ours (already prevented).
 */
export function handleAmountKeyDown(
  e: ReactKeyboardEvent,
  ctl: Controlled & { onEscape?: () => void },
): boolean {
  const k = e.key;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (/^[0-9]$/.test(k)) {
    e.preventDefault();
    if (press(k as KeypadKey, ctl)) haptic.light();
    return true;
  }
  if (k === "." || k === ",") {
    e.preventDefault();
    if (press(".", ctl)) haptic.light();
    return true;
  }
  if (k === "Backspace" || k === "Delete") {
    e.preventDefault();
    // Shift+Backspace is the keyboard equivalent of holding the key.
    if (e.shiftKey) {
      if (ctl.value !== "") haptic.warning();
      ctl.onChange("");
    } else if (press("back", ctl)) {
      haptic.light();
    }
    return true;
  }
  if (k === "Escape") {
    e.preventDefault();
    ctl.onEscape?.();
    return true;
  }
  return false;
}

// ── amount field ─────────────────────────────────────────────────────────────

export interface AmountInputProps extends Controlled {
  /** Accessible name — required; the number alone says nothing. */
  "aria-label": string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  /** Width tracks the content in `ch`, for the centred amount on Trade. */
  autoWidth?: boolean;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Escape while the field has focus. It always blurs; this additionally lets
   *  the screen dismiss the pad. */
  onEscape?: () => void;
}

export function AmountInput({
  value,
  onChange,
  onRefused,
  max,
  decimals,
  placeholder = "0",
  className,
  style,
  autoWidth,
  autoFocus,
  onFocus,
  onBlur,
  onEscape,
  ...aria
}: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  // Digits always land at the end, so the caret does too — a read-only field
  // still lets arrow keys move it, and a caret parked mid-number would lie
  // about where the next key goes.
  const toEnd = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const n = el.value.length;
    try {
      el.setSelectionRange(n, n);
    } catch {
      // Some input types reject selection ranges; nothing to recover from.
    }
  }, []);
  useEffect(toEnd, [value, toEnd]);

  return (
    <input
      ref={ref}
      type="text"
      // The two halves of the OS-keyboard suppression: `readOnly` stops iOS and
      // Android raising a software keyboard, `inputMode="none"` is the explicit
      // hint for browsers that would anyway. It stays a real focusable input, so
      // VoiceOver reads it and a Bluetooth keyboard types into it.
      readOnly
      inputMode="none"
      value={value}
      placeholder={placeholder}
      onChange={() => {
        /* read-only: every change comes through the keypad rules */
      }}
      onKeyDown={(e) =>
        handleAmountKeyDown(e, {
          value,
          onChange,
          onRefused,
          max,
          decimals,
          // Escape always means "I'm done with this field": it gives up focus,
          // and dismisses the pad on the screens where the pad is dismissible.
          onEscape: () => {
            onEscape?.();
            ref.current?.blur();
          },
        })
      }
      onFocus={() => {
        toEnd();
        onFocus?.();
      }}
      onBlur={onBlur}
      onClick={toEnd}
      autoFocus={autoFocus}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      className={className}
      style={{
        border: "none",
        background: "transparent",
        outline: "none",
        color: "inherit",
        caretColor: "var(--primary)",
        ...(autoWidth ? { width: `${Math.max(1, (value || placeholder).length)}ch` } : null),
        ...style,
      }}
      {...aria}
    />
  );
}

// ── the pad ──────────────────────────────────────────────────────────────────

export interface KeypadProps extends Controlled {
  /** Quick amounts shown in a row above the keys. */
  presets?: number[];
  /** Defaults to replacing the amount with the preset. */
  onPreset?: (v: number) => void;
  /** Screen-specific chips shown beside the presets (Max, a balance note). */
  extra?: ReactNode;
  /** The screen's primary action, kept inside the pad so it stays reachable. */
  footer?: ReactNode;
  /** Present but retracted when false; the pad animates in and out. */
  open?: boolean;
  /** Accessible name for the group. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function Keypad({
  value,
  onChange,
  onRefused,
  max,
  decimals = 2,
  presets,
  onPreset,
  extra,
  footer,
  open = true,
  label = "Amount keypad",
  className,
  style,
}: KeypadProps) {
  // The pointer handlers below outlive any one render, so they read the current
  // props through a ref that an effect keeps in step rather than closing over
  // the values a particular render happened to see.
  const ctlRef = useRef<Controlled>({ value, onChange, onRefused, max, decimals });
  useEffect(() => {
    ctlRef.current = { value, onChange, onRefused, max, decimals };
  }, [value, onChange, onRefused, max, decimals]);

  // Presence and visual state are separate so the pad can animate both ways:
  // `mounted` keeps it in the tree long enough to retract, `shown` drives the
  // transform. Closed for good, it renders nothing and gives its space back.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  if (open && !mounted) setMounted(true);
  if (!open && shown) setShown(false);


  useEffect(() => {
    if (open) {
      // Next frame, so the drawer curve has somewhere to travel from.
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    const t = window.setTimeout(() => setMounted(false), 260);
    return () => window.clearTimeout(t);
  }, [open]);

  // ── clearance ──────────────────────────────────────────────────────────────
  // The pad docks over the scrolling screen, so opening it must not bury the
  // very number being typed. On open we measure where the amount sits against
  // where the pad will land, scroll the screen up by the shortfall, and — when
  // the screen has no scroll left to give — add exactly that much room after
  // the pad so it does. Nothing is added when the amount already clears.
  const dockRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);

  if (!open && room !== 0) setRoom(0);

  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const dock = dockRef.current;
      const screen = dock?.closest(".screen") as HTMLElement | null;
      const amount = screen?.querySelector<HTMLElement>('input[inputmode="none"]');
      if (!dock || !screen || !amount) return;
      // Where the pad sits once it has arrived, whatever the animation is doing.
      const dockTop = screen.getBoundingClientRect().bottom - dock.offsetHeight;
      const need = amount.getBoundingClientRect().bottom + CLEARANCE - dockTop;
      if (need <= 0) return;
      const spare = screen.scrollHeight - screen.clientHeight - screen.scrollTop;
      if (need > spare) setRoom((r) => r + (need - spare));
      requestAnimationFrame(() => {
        screen.scrollTop += need;
      });
    };
    // Once now, once after the enter transition — the footer's label can change
    // the pad's height between the two.
    const r = requestAnimationFrame(fit);
    const t = window.setTimeout(fit, 460);
    return () => {
      cancelAnimationFrame(r);
      window.clearTimeout(t);
    };
  }, [open]);

  const [pressed, setPressed] = useState<KeypadKey | null>(null);

  // Backspace hold → clear. The fill under the key grows while it is held, so
  // the wipe is announced before it happens and letting go early cancels it.
  const backRef = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef(0);
  const holdRaf = useRef(0);
  const cleared = useRef(false);

  const setHold = useCallback(
    (p: number) => backRef.current?.style.setProperty("--hold", String(p)),
    [],
  );

  const endHold = useCallback(() => {
    window.clearTimeout(holdTimer.current);
    cancelAnimationFrame(holdRaf.current);
    holdTimer.current = 0;
    holdRaf.current = 0;
    setHold(0);
  }, [setHold]);

  useEffect(() => endHold, [endHold]);

  const startHold = useCallback(() => {
    cleared.current = false;
    const t0 = performance.now();
    const tick = (now: number) => {
      setHold(Math.min((now - t0) / CLEAR_HOLD_MS, 1));
      if (now - t0 < CLEAR_HOLD_MS) holdRaf.current = requestAnimationFrame(tick);
    };
    holdRaf.current = requestAnimationFrame(tick);
    holdTimer.current = window.setTimeout(() => {
      cleared.current = true;
      endHold();
      setPressed(null);
      // Distinct from the per-key tick: clearing the whole amount is a bigger
      // event than deleting a digit, so it gets the warning pattern.
      haptic.warning();
      ctlRef.current.onChange("");
    }, CLEAR_HOLD_MS);
  }, [endHold, setHold]);

  const onDown = useCallback(
    (key: KeypadKey) => {
      setPressed(key);
      haptic.light();
      if (key === "back") startHold();
    },
    [startHold],
  );

  const onUp = useCallback(
    (key: KeypadKey) => {
      setPressed((p) => (p === key ? null : p));
      if (key === "back") endHold();
    },
    [endHold],
  );

  const commit = useCallback((key: KeypadKey) => {
    // The hold already cleared the field; the click that follows the release
    // must not delete a character from the empty value.
    if (key === "back" && cleared.current) {
      cleared.current = false;
      return;
    }
    press(key, ctlRef.current);
  }, []);

  const key = (k: KeypadKey) => {
    const isBack = k === "back";
    return (
      <button
        key={k}
        ref={isBack ? backRef : undefined}
        type="button"
        aria-label={labelFor(k)}
        title={isBack ? "Hold to clear" : undefined}
        disabled={k === "." && decimals <= 0}
        className={`${css.key} ${isBack ? css.back : ""}`.trim()}
        data-press={pressed === k ? "true" : undefined}
        // Keep focus where it is — usually the amount field — so the caret and
        // any hardware keyboard survive a tap on the pad.
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={() => onDown(k)}
        onPointerUp={() => onUp(k)}
        onPointerCancel={() => onUp(k)}
        onPointerLeave={() => onUp(k)}
        onClick={() => commit(k)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isBack ? (
          <span style={{ display: "grid", placeItems: "center" }}>
            <Icon name="backspace" size={23} stroke={2} />
          </span>
        ) : (
          k
        )}
      </button>
    );
  };

  if (!mounted) return null;

  return (
    <>
    <div
      ref={dockRef}
      className={`${css.dock} ${className ?? ""}`.trim()}
      data-open={shown ? "true" : "false"}
      style={{ pointerEvents: shown ? undefined : "none", ...style }}
      aria-hidden={shown ? undefined : true}
      // Digits typed on a hardware keyboard while focus sits on a key still go
      // to the amount, so tabbing into the pad does not break typing.
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") return; // let the button activate
        handleAmountKeyDown(e, ctlRef.current);
      }}
    >
      {((presets && presets.length > 0) || extra) && (
        <div className={css.presets} role="group" aria-label="Quick amounts">
          {(presets ?? []).map((p) => {
            const asString = toAmountString(p, { decimals });
            const on = value === asString;
            // A preset above the ceiling stays visible and stays tappable: it
            // reads as unavailable, and pressing it says why rather than doing
            // nothing. aria-disabled, not disabled, so the reason is reachable.
            const over = exceedsMax(asString, max);
            return (
              <button
                key={p}
                type="button"
                className={`chip tap tnum ${on ? "is-on" : ""}`.trim()}
                aria-disabled={over || undefined}
                style={{ flex: "none", height: 38, opacity: over ? 0.42 : 1 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (over) {
                    haptic.warning();
                    onRefused?.();
                    return;
                  }
                  haptic.select();
                  if (onPreset) onPreset(p);
                  else onChange(asString);
                }}
              >
                ${p.toLocaleString("en-US")}
              </button>
            );
          })}
          {extra}
        </div>
      )}

      <div className={css.grid} role="group" aria-label={label}>
        {ROWS.flat().map(key)}
      </div>

      {footer && <div className={css.footer}>{footer}</div>}
    </div>
    {/* Scroll room the screen did not have, so the content can clear the pad.
        Zero unless the measurement above found a shortfall. */}
    {room > 0 && <div aria-hidden style={{ flex: "none", height: room }} />}
    </>
  );
}
