"use client";

// useAmountKeypad — the one rule set for money entry, shared by every screen
// that takes an amount (Trade buy/sell, Send, Goal, Gift). The rules live in
// pure functions below so they can be unit-tested without a DOM (see
// useAmountKeypad.test.ts); the hook is a thin state wrapper over them.
//
//   const pad = useAmountKeypad({ max: balance });
//   <AmountInput {...pad.field} aria-label="Amount to buy in dollars" />
//   <Keypad {...pad.keypad} footer={<button …/>} />
//
// The rules, in one place:
//   • digits append; the value is always a plain decimal string ("", "12.50")
//   • leading zero collapses — "0" then "5" is "5"; "0" then "." is "0."
//   • one decimal point, at most `decimals` places after it (default 2)
//   • input that would take the value over `max` is REFUSED, never clamped —
//     the value stays put and `refused` flips true so the screen can say why
//   • backspace drops one character; a 500 ms hold clears the whole amount
//
// `refused` is what lets a screen keep its "that's more than your cash" line:
// the keypad will not let you type past the balance, so the screen explains the
// silence instead of showing an error for a value that can never exist.
import { useCallback, useMemo, useState } from "react";

/** How many integer digits we will ever accept, so a stuck key can't build a
 *  number no formatter can render. Well past any real balance. */
export const MAX_INT_DIGITS = 9;

export interface AmountRules {
  /** Hard ceiling. Input that would exceed it is refused. */
  max?: number;
  /** Places allowed after the decimal point. 0 disables the decimal key. */
  decimals?: number;
}

const EPS = 1e-9;

/** Does this candidate string sit above `max`? Empty/partial values never do. */
export function exceedsMax(next: string, max?: number): boolean {
  if (max === undefined) return false;
  if (next === "" || next === ".") return false;
  const n = Number(next);
  return Number.isFinite(n) && n > max + EPS;
}

/** Digits before the decimal point. */
function intDigits(value: string): number {
  const dot = value.indexOf(".");
  return (dot === -1 ? value : value.slice(0, dot)).length;
}

/** Places after the decimal point. */
function decimalPlaces(value: string): number {
  const dot = value.indexOf(".");
  return dot === -1 ? 0 : value.length - dot - 1;
}

/**
 * Append one digit. Returns the value unchanged when the rules refuse it, so
 * callers can compare identity to detect a refusal.
 */
export function appendDigit(value: string, digit: string, rules: AmountRules = {}): string {
  const { decimals = 2, max } = rules;
  if (!/^[0-9]$/.test(digit)) return value;

  // Leading zero: "0" is a placeholder, not a digit you build on. "0" + "5" is
  // "5"; "0" + "0" stays "0". Once there's a decimal point, "0.0" is real.
  const next = value === "0" ? digit : value + digit;

  if (decimalPlaces(next) > decimals) return value;
  if (intDigits(next) > MAX_INT_DIGITS) return value;
  if (exceedsMax(next, max)) return value;
  return next;
}

/** Append the decimal point. One only, and never when `decimals` is 0. */
export function appendDot(value: string, rules: AmountRules = {}): string {
  const { decimals = 2 } = rules;
  if (decimals <= 0) return value;
  if (value.includes(".")) return value;
  // Typing "." first means "nought point…", so the value reads as a number
  // from the very first keystroke rather than starting with a bare point.
  return value === "" ? "0." : `${value}.`;
}

/** Drop the last character. "12." → "12", "1" → "". */
export function applyBackspace(value: string): string {
  return value.length <= 1 ? "" : value.slice(0, -1);
}

/**
 * A preset or Max button's value as a keypad string: no trailing zeros, no
 * more than `decimals` places, and floored (never rounded up) so a "Max" chip
 * can't hand back more money than there is.
 */
export function toAmountString(n: number, rules: AmountRules = {}): string {
  const { decimals = 2 } = rules;
  if (!Number.isFinite(n) || n <= 0) return "";
  const p = 10 ** decimals;
  let s = (Math.floor(n * p + EPS) / p).toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/**
 * Coerce anything (a pasted string, a restored draft, a preset) into a legal
 * keypad value: digits and at most one point, capped at `decimals` places.
 * Does NOT apply `max` — callers decide whether to refuse or accept.
 */
export function sanitizeAmount(raw: string, rules: AmountRules = {}): string {
  const { decimals = 2 } = rules;
  let v = String(raw).replace(/[^0-9.]/g, "");
  const first = v.indexOf(".");
  if (first !== -1) v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, "");
  if (decimals <= 0) v = v.split(".")[0];
  const dot = v.indexOf(".");
  if (dot !== -1 && v.length - dot - 1 > decimals) v = v.slice(0, dot + 1 + decimals);
  // Collapse a leading run of zeros ("007" → "7", "00.5" → "0.5"), keeping "0"/"0.x".
  v = v.replace(/^0+(?=\d)/, "");
  if (v.startsWith(".")) v = `0${v}`;
  const ints = intDigits(v);
  if (ints > MAX_INT_DIGITS) {
    const dot2 = v.indexOf(".");
    const head = (dot2 === -1 ? v : v.slice(0, dot2)).slice(0, MAX_INT_DIGITS);
    v = dot2 === -1 ? head : head + v.slice(dot2);
  }
  return v;
}

/** Keypad keys, as the component and the keyboard handler both name them. */
export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "clear";

/** Apply one key press to a value. Identity return means the key was refused. */
export function applyKey(value: string, key: KeypadKey, rules: AmountRules = {}): string {
  if (key === "back") return applyBackspace(value);
  if (key === "clear") return "";
  if (key === ".") return appendDot(value, rules);
  return appendDigit(value, key, rules);
}

export interface UseAmountKeypadResult {
  /** The raw amount string — "" when empty, never formatted currency. */
  value: string;
  /** Set it from anywhere (preset, Max, a restored draft). Sanitized, and
   *  refused if it would exceed `max`. */
  setValue: (next: string) => void;
  /** What to render: the value, or "0" when it is empty. */
  display: string;
  /** A usable amount: a finite number above zero and within `max`. */
  valid: boolean;
  /** The current value is above `max` (only reachable if `max` shrank under it). */
  tooBig: boolean;
  /** The last input was refused for exceeding `max`. Clears on the next accepted
   *  change, so a screen can show "that's more than your cash" while it stands. */
  refused: boolean;
  /** The numeric value, 0 when empty. */
  amount: number;
  /** Spread onto `<AmountInput />`. */
  field: { value: string; onChange: (next: string) => void; onRefused: () => void; max?: number; decimals: number };
  /** Spread onto `<Keypad />`. */
  keypad: { value: string; onChange: (next: string) => void; onRefused: () => void; max?: number; decimals: number };
}

export function useAmountKeypad(
  rules: AmountRules & { initial?: string } = {},
): UseAmountKeypadResult {
  const { max, decimals = 2, initial } = rules;
  const [value, setRaw] = useState(() => sanitizeAmount(initial ?? "", { decimals }));
  const [refused, setRefused] = useState(false);

  const setValue = useCallback(
    (next: string) => {
      const clean = sanitizeAmount(next, { decimals });
      if (exceedsMax(clean, max)) {
        setRefused(true);
        return;
      }
      setRefused(false);
      setRaw(clean);
    },
    [decimals, max],
  );

  const onRefused = useCallback(() => setRefused(true), []);

  const amount = value === "" ? 0 : Number(value);
  const n = Number.isFinite(amount) ? amount : 0;
  const tooBig = max !== undefined && n > max + EPS;

  const bind = useMemo(
    () => ({ value, onChange: setValue, onRefused, max, decimals }),
    [value, setValue, onRefused, max, decimals],
  );

  return {
    value,
    setValue,
    display: value === "" ? "0" : value,
    valid: n > 0 && !tooBig,
    tooBig,
    refused,
    amount: n,
    field: bind,
    keypad: bind,
  };
}
