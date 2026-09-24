"use client";

// MarketStatusBadge — the plain-words state for one BSC venue or ticker: "Open",
// "Paused", "Closed · opens Mon 9:30 AM" — in the viewer's own local time and zone
// (`nextOpenMs` is an instant, not an ET string, so `toLocaleString` renders it
// wherever the viewer actually is). Mirrors the dot-and-chip idiom `MarketStatus`
// already uses for the NYSE calendar on Base/Mantle (design/MarketStatus.tsx),
// but reads a single venue's `MarketState` instead of computing one itself —
// a bStock row's state can differ from Ondo's for the same ticker.
import type { CSSProperties } from "react";
import type { MarketState } from "@/lib/rwa";

const LABEL: Record<MarketState, string> = {
  open: "Open",
  premarket: "Pre-market",
  postmarket: "After hours",
  overnight: "Closed",
  closed: "Closed",
  paused: "Paused",
  unsupported: "Unavailable",
};

const OPEN_TIME_FMT: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };

export interface MarketStatusBadgeProps {
  state: MarketState;
  /** Epoch ms of the next regular-session open; the "opens <time>" clause when present. */
  nextOpenMs: number | null;
  style?: CSSProperties;
}

export function MarketStatusBadge({ state, nextOpenMs, style }: MarketStatusBadgeProps) {
  const live = state === "open";
  const opensAt = state !== "open" && nextOpenMs !== null ? new Date(nextOpenMs).toLocaleString(undefined, OPEN_TIME_FMT) : undefined;
  const text = opensAt ? `${LABEL[state]} · opens ${opensAt}` : LABEL[state];

  return (
    <span
      className="chip"
      style={{
        height: 22,
        padding: "0 9px",
        gap: 6,
        fontSize: 11.5,
        fontWeight: 600,
        color: "var(--ink-2)",
        boxShadow: "none",
        background: "var(--surface-2)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flex: "none",
          background: live ? "var(--pos)" : "var(--ink-3)",
          boxShadow: live ? "0 0 0 3px color-mix(in srgb, var(--pos) 22%, transparent)" : "none",
        }}
      />
      {text}
    </span>
  );
}
