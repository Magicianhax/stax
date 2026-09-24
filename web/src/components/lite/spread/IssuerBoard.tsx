"use client";

// IssuerBoard — the ranked list behind "the two issuers": every dual-listed stock, biggest price
// difference between bStock and Ondo first, each row read as one plain sentence ("NVDA · Ondo is
// $0.40 cheaper than bStock right now"). Fed by GET /api/rwa/spread's `board` (lib/spread.ts
// builds the ranking and the sentence; this component only lays it out) — not routed yet, see
// wiringNeeded in the wave report for where a screen should mount it.
//
// Each row is its own 44px+ tap target (a real <button>, not a styled <div>) so a tap can open
// that ticker's detail screen with PriceVsRealShare already showing the right history.
import type { CSSProperties } from "react";
import { Icon } from "@/components/design";
import type { SpreadBoardRow } from "@/lib/spread";

export interface IssuerBoardProps {
  rows: readonly SpreadBoardRow[];
  /** Fires with the row's ticker when tapped; the caller decides where that goes. */
  onSelect?: (ticker: string) => void;
  style?: CSSProperties;
}

export function IssuerBoard({ rows, onSelect, style }: IssuerBoardProps) {
  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: "22px 18px", textAlign: "center", ...style }}>
        <div className="body-sm" style={{ color: "var(--ink-3)" }}>
          Nothing to compare right now — check back once both issuers list the same stocks.
        </div>
      </div>
    );
  }

  return (
    <div className="card" role="list" aria-label="Which issuer is cheaper" style={{ padding: "2px 14px", ...style }}>
      {rows.map((row, i) => (
        <button
          key={row.ticker}
          type="button"
          role="listitem"
          onClick={() => onSelect?.(row.ticker)}
          className="row tap"
          style={{
            width: "100%",
            textAlign: "left",
            padding: "13px 0",
            background: "none",
            border: 0,
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderTop: i ? "1px solid var(--line-2)" : "none",
            cursor: onSelect ? "pointer" : "default",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)" }}>{row.ticker}</div>
            <div className="body-sm" style={{ marginTop: 2, color: "var(--ink-2)" }}>{row.sentence}</div>
          </div>
          {onSelect && <Icon name="chevR" size={18} style={{ color: "var(--ink-3)", flex: "none" }} />}
        </button>
      ))}
    </div>
  );
}
