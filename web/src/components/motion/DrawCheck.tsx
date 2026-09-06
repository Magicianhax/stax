"use client";

// DrawCheck — a filled disc that pops in (--ease-soft) then draws its check
// stroke over 0.5 s. One check per screen: the receipt hero, a placing step.
//
//   <DrawCheck size={56} delay={0.2} tone="primary" />
//
// Props
//   size   px, default 56
//   delay  seconds before the disc pops (the check follows 0.22 s later)
//   tone   "primary" (sage gradient) | "accent" (teal); default "primary"
// Reduced motion → disc fades in, check is already drawn.
import type { CSSProperties } from "react";
import s from "./motion.module.css";

export interface DrawCheckProps {
  size?: number;
  delay?: number;
  tone?: "primary" | "accent";
  className?: string;
  style?: CSSProperties;
}

export function DrawCheck({ size = 56, delay = 0, tone = "primary", className, style }: DrawCheckProps) {
  const bg = tone === "accent" ? "var(--accent)" : "var(--hero-grad)";
  const ink = tone === "accent" ? "#fff" : "var(--primary-ink)";
  return (
    <span
      aria-hidden
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-grid",
        placeItems: "center",
        flex: "none",
        ...style,
      }}
    >
      <span
        className={s.checkDisc}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: bg,
          display: "grid",
          placeItems: "center",
          boxShadow: `0 4px ${Math.round(size / 3)}px color-mix(in srgb, var(--primary) 30%, transparent)`,
          animationDelay: `${delay}s`,
        }}
      >
        <svg
          width={Math.round(size * 0.5)}
          height={Math.round(size * 0.5)}
          viewBox="0 0 24 24"
          fill="none"
          stroke={ink}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: "block" }}
        >
          <path
            d="M5 12.5 L10 17.5 L19 7"
            className={s.checkPath}
            pathLength={48}
            style={{ animationDelay: `${delay + 0.22}s` }}
          />
        </svg>
      </span>
    </span>
  );
}
