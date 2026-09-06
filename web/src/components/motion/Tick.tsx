"use client";

// Tick — a live price cell. On value change the cell washes --primary-soft (up)
// or terracotta at 18 % (down) for 0.7 s while the digits crossfade.
//
//   <Tick value={price} />                         "$231.48"
//   <Tick value={pct} format={(v) => `${v.toFixed(2)}%`} />
//
// Props: value (number), format (default USD 2dp), className / style (span).
// First paint is static. Reduced motion → digits fade only.
import { useEffect, useState, type CSSProperties } from "react";
import { formatMoney } from "./Money";
import s from "./motion.module.css";

export interface TickProps {
  value: number;
  format?: (v: number) => string;
  className?: string;
  style?: CSSProperties;
}

export function Tick({ value, format = (v) => formatMoney(v), className, style }: TickProps) {
  const [last, setLast] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  // `gen` counts changes: it keys the digit span (remount = crossfade) and gates
  // the animation so the first paint is static.
  const [gen, setGen] = useState(0);
  if (value !== last) {
    setLast(value);
    setDir(value > last ? "up" : "down");
    setGen((g) => g + 1);
  }

  useEffect(() => {
    if (!dir) return;
    const t = setTimeout(() => setDir(null), 200); // + 0.5 s fade = 0.7 s wash
    return () => clearTimeout(t);
  }, [dir, gen]);

  return (
    <span
      className={`tnum ${s.tick}${className ? ` ${className}` : ""}`}
      data-dir={dir ?? undefined}
      style={style}
    >
      <span key={gen} className={gen > 0 ? s.tickDigits : undefined}>
        {format(value)}
      </span>
    </span>
  );
}
