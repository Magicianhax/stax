"use client";

// EarningsChip — the quiet, plain-words line for "when does this company next report earnings":
// "Nvidia reports results in 33 days · Wed, Oct 28" or "Next results date not announced yet". Fed by
// GET /api/earnings's per-ticker EarningsInfo (lib/earnings.ts owns the copy and day-counting;
// this component only lays it out). Not routed yet — see wiringNeeded for where AssetDetail
// should mount it and how the rules stream's evaluator should be fed the same `nextMs`.
//
// Same quiet-metadata register DESIGN.md gives MarketStatus's pill: a `.chip` at `--ink-2`
// (12.5px/600 — --ink-3 failed AA on --surface-2, design critique P1 #13), no dot, no color signal — this is a fact to note in passing, not a status to
// react to, so it never competes with the buy/sell decision the screen is actually asking for.
import type { CSSProperties } from "react";
import { Icon } from "@/components/design";
import { earningsChipText } from "@/lib/earnings";
import type { EarningsInfo } from "@/lib/earnings";

export interface EarningsChipProps {
  /** null/undefined both read as "not announced yet" — a loading state and a genuinely unknown
   *  ticker shouldn't need two different chips. */
  info: EarningsInfo | null | undefined;
  /** "Nvidia" — the chip says who reports, not a bare "Earnings". */
  companyName?: string;
  nowMs?: number;
  style?: CSSProperties;
}

export function EarningsChip({ info, companyName, nowMs, style }: EarningsChipProps) {
  const text = earningsChipText(info, nowMs, companyName);
  return (
    <span
      className="chip"
      style={{
        display: "inline-flex",
        alignItems: "flex-start",
        gap: 6,
        // `.stax .chip` fixes 38px for tappable chips; this one is a label (P0 #4).
        height: "auto",
        minHeight: 22,
        padding: "3px 9px",
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.3,
        color: "var(--ink-2)",
        background: "var(--surface-2)",
        boxShadow: "none",
        whiteSpace: "normal",
        maxWidth: "100%",
        ...style,
      }}
    >
      <Icon name="clock" size={13} stroke={2} style={{ flex: "none", marginTop: 2, color: "var(--ink-2)" }} />
      {text}
    </span>
  );
}
