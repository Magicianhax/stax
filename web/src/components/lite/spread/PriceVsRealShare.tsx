"use client";

// PriceVsRealShare — a small line chart of the token's on-chain price against the real share's
// reference price over time, for one issuer. Fed by GET /api/rwa/spread/[ticker]'s per-venue
// `points` (lib/spread.ts's SpreadPoint[]); not routed yet, see wiringNeeded.
//
// Deliberately its own plain SVG rather than reusing components/design/Charts.tsx's PriceChart:
// that component draws exactly one series and densifies short series with a small deterministic
// wobble so a demo sparkline still looks "alive" — right for a single balance line, wrong here,
// where the whole point is the honest gap between two real values. No dependency was added for
// this (the app has no chart library — grep found none); two static, smooth-but-exact polylines
// keep the same visual language (soft card, --primary/--accent, --line-2 gridline, tabular
// numerals) without pretending either series moved when it didn't.
//
// Times render in the viewer's own clock (`toLocaleString` with no timeZone, same as
// MarketStatusBadge), labelled "your time" per this stream's copy rule.
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { usd } from "@/lib/format";
import type { SpreadPoint } from "@/lib/spread";

export interface PriceVsRealShareProps {
  ticker: string;
  points: readonly SpreadPoint[];
  height?: number;
  style?: CSSProperties;
}

const TIME_FMT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

// Catmull-Rom → cubic bezier, same construction Charts.tsx's PriceChart uses, so a line here
// reads as the same family of curve without importing that component's single-series machinery.
function smoothPath(pts: readonly (readonly [number, number])[]): string {
  if (pts.length < 2) return "";
  const d = [`M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`);
  }
  return d.join(" ");
}

export function PriceVsRealShare({ ticker, points, height = 160, style }: PriceVsRealShareProps) {
  const id = useId().replace(/:/g, "");
  // `toLocaleString` with no explicit locale follows the runtime's default, which can differ
  // between the server (Node/ICU) and the browser (e.g. 24h vs 12h) and would otherwise mismatch
  // on hydration. Rendering the formatted timestamp only after mount — same one-frame-late idiom
  // Charts.tsx's useDrawn uses for its own mount-driven draw-in — means the server and the first
  // client paint agree (both render nothing), and the real value fills in a frame later.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.flatMap((p) => [p.tokenPrice, p.referencePrice]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 10; // % of height kept clear top/bottom
    const at = (v: number, i: number) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 100 - pad - ((v - min) / span) * (100 - pad * 2);
      return [x, y] as const;
    };
    const tokenPts = points.map((p, i) => at(p.tokenPrice, i));
    const refPts = points.map((p, i) => at(p.referencePrice, i));
    return {
      tokenLine: smoothPath(tokenPts),
      refLine: smoothPath(refPts),
      first: points[0],
      last: points[points.length - 1],
    };
  }, [points]);

  const first = points[0];
  const last = points[points.length - 1];
  const description =
    first && last
      ? `${ticker} token price ${usd(first.tokenPrice)} to ${usd(last.tokenPrice)}, real share price ${usd(first.referencePrice)} to ${usd(last.referencePrice)}, over the shown period.`
      : `No price history for ${ticker} yet.`;

  return (
    <div className="card" style={{ padding: "16px 16px 14px", ...style }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", rowGap: 4, marginBottom: 10 }}>
        <div className="body-sm" style={{ display: "flex", alignItems: "center", gap: 14, flex: "none" }}>
          <Legend swatch="var(--primary)" label={`${ticker} on-chain`} />
          <Legend swatch="var(--ink-3)" label="Real share" dashed />
        </div>
        {last && mounted && (
          <span className="tnum body-sm" style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>
            as of {new Date(last.t).toLocaleString(undefined, TIME_FMT)}, your time
          </span>
        )}
      </div>

      {!geom ? (
        <div
          className="body-sm"
          style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)" }}
        >
          Not enough history yet — check back soon.
        </div>
      ) : (
        <div style={{ position: "relative", height }} role="img" aria-label={description}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden>
            <line x1="0" y1="25" x2="100" y2="25" stroke="var(--line-2)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="var(--line-2)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="75" x2="100" y2="75" stroke="var(--line-2)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            <path
              d={geom.refLine}
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth={1.6}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
            <path
              id={`token-line-${id}`}
              d={geom.tokenLine}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
}

function Legend({ swatch, label, dashed }: { swatch: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
      <span
        aria-hidden
        style={{
          width: 12,
          height: dashed ? 0 : 2,
          borderTop: dashed ? `1.6px dashed ${swatch}` : `2px solid ${swatch}`,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
