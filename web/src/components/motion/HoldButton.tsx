"use client";

// HoldButton — a .btn.btn-primary that must be held (900 ms) to confirm. An SVG
// ring beside the label fills while holding and snaps back on early release.
//
//   <HoldButton onComplete={place} ms={900} block>Hold to buy</HoldButton>
//
// Props: onComplete, ms (default 900), disabled, block (btn-block), hint (text
// shown while holding; default "Keep holding…"), className / style, children.
import type { CSSProperties, ReactNode } from "react";
import { useHoldPress } from "./useHoldPress";
import s from "./motion.module.css";

export interface HoldButtonProps {
  onComplete: () => void;
  ms?: number;
  disabled?: boolean;
  block?: boolean;
  hint?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const R = 9;
const C = 2 * Math.PI * R;

export function HoldButton({
  onComplete,
  ms = 900,
  disabled = false,
  block = true,
  hint = "Keep holding…",
  className,
  style,
  children,
}: HoldButtonProps) {
  const { bind, progress, holding } = useHoldPress({ ms, onComplete, disabled });
  return (
    <button
      type="button"
      {...bind}
      disabled={disabled}
      aria-label={typeof children === "string" ? `${children} (press and hold)` : undefined}
      data-holding={holding ? "true" : "false"}
      className={`btn btn-primary${block ? " btn-block" : ""} ${s.holdBtn}${className ? ` ${className}` : ""}`}
      style={{ opacity: disabled ? 0.5 : 1, ...style }}
    >
      <svg className={s.holdRing} width={22} height={22} viewBox="0 0 22 22" aria-hidden>
        <circle className={s.holdRingTrack} cx={11} cy={11} r={R} fill="none" stroke="currentColor" strokeWidth={2.5} />
        <circle
          className={s.holdRingFill}
          cx={11}
          cy={11}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
        />
      </svg>
      <span>{holding && progress < 1 ? hint : children}</span>
    </button>
  );
}
