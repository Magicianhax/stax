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
// Design critique P1 #8: the y-domain is padded to at least ±2% of the real share's price
// (lib/spread.ts `realShareChartDomain`), so a $1 wobble on a $180 share draws as the small move
// it is; the card has a title, plain legend words, and each line's latest $ value at its end.
//
// Times render in the viewer's own clock (`toLocaleString` with no timeZone, same as
// MarketStatusBadge), labelled "your time" per this stream's copy rule.
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { usd } from "@/lib/format";
import { realShareChartDomain, type SpreadPoint } from "@/lib/spread";

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
    const { min, max } = realShareChartDomain(points);
    const span = max - min || 1;
    const pad = 10; // % of height kept clear top/bottom
    const at = (v: number, i: number) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 100 - pad - ((v - min) / span) * (100 - pad * 2);
      return [x, y] as const;
    };
    const tokenPts = points.map((p, i) => at(p.tokenPrice, i));
    const refPts = points.map((p, i) => at(p.referencePrice, i));
    // End labels sit in a right gutter at each line's last y (% of height), nudged apart so the
    // two never overlap when the prices are close.
    let tokenY = tokenPts[tokenPts.length - 1][1];
    let refY = refPts[refPts.length - 1][1];
    const MIN_GAP = 13; // % of height ≈ one label line at the default 160px
    if (Math.abs(tokenY - refY) < MIN_GAP) {
      const mid = (tokenY + refY) / 2;
      const tokenAbove = tokenY <= refY;
      tokenY = Math.max(6, Math.min(94, mid + (tokenAbove ? -MIN_GAP / 2 : MIN_GAP / 2)));
      refY = Math.max(6, Math.min(94, mid + (tokenAbove ? MIN_GAP / 2 : -MIN_GAP / 2)));
    }
    return {
      tokenLine: smoothPath(tokenPts),
      refLine: smoothPath(refPts),
      first: points[0],
      last: points[points.length - 1],
      tokenY,
      refY,
    };
  }, [points]);

  const first = points[0];
  const last = points[points.length - 1];
  const description =
    first && last
      ? `Price here ${usd(first.tokenPrice)} to ${usd(last.tokenPrice)}, real share ${usd(first.referencePrice)} to ${usd(last.referencePrice)}, over the shown period.`
      : `No price history for ${ticker} yet.`;

  return (
    <div className="card" style={{ padding: "16px 16px 14px", ...style }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: "-.01em", color: "var(--ink)" }}>
        What you pay vs the real share
      </h3>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", rowGap: 4, margin: "6px 0 10px" }}>
        <div className="body-sm" style={{ display: "flex", alignItems: "center", gap: 14, flex: "none" }}>
          <Legend swatch="var(--primary)" label="Price here" />
          <Legend swatch="var(--ink-2)" label="Real share" dashed />
        </div>
        {last && mounted && (
          <span className="tnum body-sm" style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>
            as of {new Date(last.t).toLocaleString(undefined, TIME_FMT)}, your time
          </span>
        )}
      </div>

      {!geom ? (
        <div
          className="body-sm"
          style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-2)" }}
        >
          Not enough history yet — check back soon.
        </div>
      ) : (
        <div style={{ position: "relative", height, paddingRight: 66 }} role="img" aria-label={description}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden style={{ display: "block", overflow: "visible" }}>
            <line x1="0" y1="25" x2="100" y2="25" stroke="var(--line-2)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="var(--line-2)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="75" x2="100" y2="75" stroke="var(--line-2)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            <path
              d={geom.refLine}
              fill="none"
              stroke="var(--ink-2)"
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
          <EndLabel y={geom.tokenY} color="var(--primary)" value={usd(geom.last.tokenPrice)} strong />
          <EndLabel y={geom.refY} color="var(--ink-2)" value={usd(geom.last.referencePrice)} />
        </div>
      )}
    </div>
  );
}

function EndLabel({ y, color, value, strong }: { y: number; color: string; value: string; strong?: boolean }) {
  return (
    <span
      aria-hidden
      className="tnum"
      style={{
        position: "absolute",
        right: 0,
        top: `${y}%`,
        transform: "translateY(-50%)",
        width: 60,
        textAlign: "right",
        fontSize: 12,
        fontWeight: strong ? 700 : 600,
        lineHeight: 1.2,
        color: strong ? "var(--ink)" : "var(--ink-2)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 99, background: color, flex: "none" }} />
      {value}
    </span>
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
