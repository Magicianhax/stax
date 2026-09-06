"use client";

// Money — a tabular-numeral amount that counts to its new value and flashes.
//
//   <Money value={240.55} />                            static on first paint
//   <Money value={140.55} prev={240.55} size={34} />    counts 240.55 → 140.55 on mount
//
// Props
//   value     number (USD by default)
//   prev      optional start value for a count on FIRST paint (e.g. the balance
//             before a trade). Without it the first paint is static and only
//             later `value` changes count (0.6 s) from the last rendered value.
//   currency  ISO code, default "USD" (renders "$")
//   dp        decimals, default 2
//   compact   "$1.2K" style
//   size      font-size px; className / style pass through (span)
// On change the text flashes --pos / --neg for 0.9 s (data-dir="up|down").
// Reduced motion → snaps to the value, still flashes colour.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import gsap from "gsap";
import { reducedMotion } from "./reduced";
import s from "./motion.module.css";

export interface MoneyProps {
  value: number;
  prev?: number;
  currency?: string;
  dp?: number;
  compact?: boolean;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function formatMoney(v: number, currency = "USD", dp = 2, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: compact ? 0 : dp,
    maximumFractionDigits: compact ? 1 : dp,
    notation: compact ? "compact" : "standard",
  }).format(v);
}

/** Direction of the most recent change to `value`; null after `holdMs`. */
export function useMoneyDelta(value: number, holdMs = 400): "up" | "down" | null {
  const [last, setLast] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [gen, setGen] = useState(0);
  if (value !== last) {
    setLast(value);
    setDir(value > last ? "up" : "down");
    setGen((g) => g + 1);
  }
  useEffect(() => {
    if (!dir) return;
    const t = setTimeout(() => setDir(null), holdMs);
    return () => clearTimeout(t);
  }, [dir, gen, holdMs]);
  return dir;
}

export function Money({
  value,
  prev,
  currency = "USD",
  dp = 2,
  compact = false,
  size,
  className,
  style,
}: MoneyProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  // Last value the DOM actually showed; undefined until first paint.
  const shown = useRef<number | undefined>(undefined);
  const dir = useMoneyDelta(value);

  // Plain layout effect, not useGSAP: StrictMode runs effects twice and
  // useGSAP's cleanup reverts the tween to progress 0, which would leave the
  // DOM stuck on the start value. Here cleanup only kills the tween and records
  // what is on screen, so a re-run (or a change mid-count) continues from there.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current === undefined ? prev : shown.current;
    shown.current = value;
    if (from === undefined || from === value || reducedMotion()) {
      el.textContent = formatMoney(value, currency, dp, compact);
      return;
    }
    const proxy = { v: from };
    const tween = gsap.to(proxy, {
      v: value,
      duration: 0.6,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = formatMoney(proxy.v, currency, dp, compact);
      },
      onComplete: () => {
        el.textContent = formatMoney(value, currency, dp, compact);
      },
    });
    return () => {
      tween.kill();
      shown.current = tween.progress() >= 1 ? value : proxy.v;
    };
    // `prev` only seeds the first count; formatting props don't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span
      ref={ref}
      className={`tnum ${s.money}${className ? ` ${className}` : ""}`}
      data-dir={dir ?? undefined}
      style={{ fontSize: size, ...style }}
    >
      {formatMoney(value, currency, dp, compact)}
    </span>
  );
}
