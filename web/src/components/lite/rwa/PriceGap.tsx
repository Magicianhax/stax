"use client";

// PriceGap — the token's premium or discount against the real share it tracks,
// e.g. "+0.4% vs NVDA". When the ticker is dual-listed, the other issuer's figure
// follows in parentheses so both venues stay readable in one line without a
// second row. `null` gaps (lib/rwa.ts's gapPct — no usable reference) are simply
// left out rather than shown as a fake 0%.
import type { CSSProperties } from "react";
import type { RwaPlatform } from "@/lib/chains";

const PLATFORM_LABEL: Record<RwaPlatform, string> = { bstock: "bStock", ondo: "Ondo" };

function fmtGap(pct: number): string {
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export interface PriceGapProps {
  /** The underlying ticker, e.g. "NVDA" — the "vs NVDA" clause. */
  ticker: string;
  venues: { platform: RwaPlatform; gapPct: number | null }[];
  style?: CSSProperties;
}

export function PriceGap({ ticker, venues, style }: PriceGapProps) {
  const shown = venues.filter((v): v is { platform: RwaPlatform; gapPct: number } => v.gapPct !== null);
  if (shown.length === 0) return null;
  const [first, ...rest] = shown;

  return (
    <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", ...style }}>
      {fmtGap(first.gapPct)} vs {ticker}
      {rest.length > 0 && (
        <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>
          {" "}
          ({rest.map((v) => `${PLATFORM_LABEL[v.platform]} ${fmtGap(v.gapPct)}`).join(", ")})
        </span>
      )}
    </span>
  );
}
