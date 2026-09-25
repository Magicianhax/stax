"use client";

// EarningsChip — the quiet, plain-words line for "when does this company next report earnings":
// "Earnings in 3 days · Wed, Oct 28 your time" or "Earnings date not announced yet". Fed by
// GET /api/earnings's per-ticker EarningsInfo (lib/earnings.ts owns the copy and day-counting;
// this component only lays it out). Not routed yet — see wiringNeeded for where AssetDetail
// should mount it and how the rules stream's evaluator should be fed the same `nextMs`.
//
// Same quiet-metadata register DESIGN.md gives MarketStatus's pill: a `.chip` at `--ink-3`
// (12.5px/600), no dot, no color signal — this is a fact to note in passing, not a status to
// react to, so it never competes with the buy/sell decision the screen is actually asking for.
import type { CSSProperties } from "react";
import { Icon } from "@/components/design";
import { earningsChipText } from "@/lib/earnings";
import type { EarningsInfo } from "@/lib/earnings";

export interface EarningsChipProps {
  /** null/undefined both read as "not announced yet" — a loading state and a genuinely unknown
   *  ticker shouldn't need two different chips. */
  info: EarningsInfo | null | undefined;
  nowMs?: number;
  style?: CSSProperties;
}

export function EarningsChip({ info, nowMs, style }: EarningsChipProps) {
  const text = earningsChipText(info, nowMs);
  return (
    <span
      className="chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.3,
        color: "var(--ink-3)",
        background: "var(--surface-2)",
        boxShadow: "none",
        whiteSpace: "normal",
        maxWidth: "100%",
        ...style,
      }}
    >
      <Icon name="clock" size={13} stroke={2} style={{ flex: "none", color: "var(--ink-3)" }} />
      {text}
    </span>
  );
}
