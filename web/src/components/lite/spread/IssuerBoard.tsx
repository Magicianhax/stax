"use client";

// IssuerBoard — the ranked list behind "the two issuers": every dual-listed stock, biggest price
// difference between bStock and Ondo first, each row the company's name and logo over one plain
// sentence ("Ondo is $2.30 cheaper (0.7%) · open now"). Fed by GET /api/rwa/spread's `board`
// (lib/spread.ts ranks the rows; `issuerDiffSentence` owns the words).
//
// Differences under 0.1% aren't worth a decision, so they sit in their own quiet "About the
// same price" group below the rest (design critique P2 #14). Each row is a real <button> inside
// an <li>, so the list semantics come from the markup, not a role on the button.
import type { CSSProperties } from "react";
import { Icon } from "@/components/design";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { displayFor } from "@/lib/displayAssets";
import { isAboutSamePrice, issuerDiffSentence, type SpreadBoardRow } from "@/lib/spread";

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
        <div className="body-sm" style={{ color: "var(--ink-2)" }}>
          Nothing to compare right now. Check back once both companies list the same stocks.
        </div>
      </div>
    );
  }

  const different = rows.filter((r) => !isAboutSamePrice(r));
  const same = rows.filter((r) => isAboutSamePrice(r));

  return (
    <div style={style}>
      {different.length > 0 && <BoardList rows={different} onSelect={onSelect} label="Which is cheaper" />}
      {same.length > 0 && (
        <>
          <h3 style={{ margin: different.length > 0 ? "20px 2px 8px" : "0 2px 8px", fontSize: 14, fontWeight: 600, color: "var(--ink-2)" }}>
            About the same price
          </h3>
          <BoardList rows={same} onSelect={onSelect} label="About the same price" quiet />
        </>
      )}
    </div>
  );
}

function BoardList({
  rows,
  onSelect,
  label,
  quiet,
}: {
  rows: readonly SpreadBoardRow[];
  onSelect?: (ticker: string) => void;
  label: string;
  /** "About the same price" rows: the group heading already says it, so no sentence per row. */
  quiet?: boolean;
}) {
  return (
    <ul className="card" aria-label={label} style={{ listStyle: "none", margin: 0, padding: "2px 14px" }}>
      {rows.map((row, i) => {
        const d = displayFor(row.ticker);
        const sentence = issuerDiffSentence(row);
        return (
          <li key={row.ticker} style={{ borderTop: i ? "1px solid var(--line-2)" : "none" }}>
            <button
              type="button"
              onClick={() => onSelect?.(row.ticker)}
              className="row tap"
              aria-label={`${d.name}: ${sentence}`}
              style={{
                width: "100%",
                minHeight: 56,
                textAlign: "left",
                padding: "12px 0",
                background: "none",
                border: 0,
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: onSelect ? "pointer" : "default",
              }}
            >
              <TokenLogo symbol={row.ticker} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.name}
                </div>
                {!quiet && (
                  <div className="tnum" style={{ marginTop: 2, fontSize: 13, lineHeight: 1.4, color: "var(--ink-2)" }}>
                    {sentence}
                  </div>
                )}
              </div>
              {onSelect && <Icon name="chevR" size={18} style={{ color: "var(--ink-2)", flex: "none" }} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
