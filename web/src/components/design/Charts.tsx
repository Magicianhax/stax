"use client";

// Stax data-viz primitives — ported from the design handoff (components.jsx).
// Sparkline, RiskMeter, Donut, CountUp. Presentational + reusable.
import { useEffect, useId, useState, type ReactNode } from "react";

export interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  /** Thicker stroke + filled area gradient. */
  strong?: boolean;
}

export function Sparkline({
  data,
  w = 64,
  h = 24,
  color = "var(--pos)",
  strong = false,
}: SparklineProps) {
  const id = useId().replace(/:/g, "");
  if (!data.length) return <svg width={w} height={h} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - ((v - min) / span) * (h - 3) - 1.5;
    return [x, y] as const;
  });
  const d = pts
    .map((point, i) => (i ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1))
    .join(" ");
  const area = d + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={strong ? 0.22 : 0.14} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {strong && <path d={area} fill={`url(#sp${id})`} />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strong ? 2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Big price chart ──────────────────────────────────────────────────────────
// A full-width area chart for the asset detail + trade screens. Smooth Catmull-Rom
// curve, gradient area fill, faint gridlines, and a glowing end dot. The coarse
// reference spark is densified deterministically so it reads like a real price line.

// Catmull-Rom → cubic bezier for a smooth line through the points.
function smoothPath(p: readonly (readonly [number, number])[]): string {
  if (p.length < 2) return "";
  const d = [`M ${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`,
    );
  }
  return d.join(" ");
}

// Interpolate between coarse points + add a small deterministic wobble so the
// line looks like real intraday movement (no Math.random — stable across renders).
function densify(src: number[], steps = 6): number[] {
  if (src.length < 2) return src;
  const out: number[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const e = t * t * (3 - 2 * t); // smoothstep
      const wob = Math.sin((i * steps + s) * 1.7) * (Math.abs(b - a) * 0.14 + 0.05);
      out.push(a + (b - a) * e + wob);
    }
  }
  out.push(src[src.length - 1]);
  return out;
}

export interface PriceChartProps {
  data: number[];
  /** Up = positive (green) / down = negative (red) coloring. */
  up?: boolean;
  /** Pixel height. */
  height?: number;
  /** Screen-reader description of the trend (charts are otherwise invisible to SR). */
  label?: string;
}

export function PriceChart({ data, up = true, height = 210, label }: PriceChartProps) {
  const id = useId().replace(/:/g, "");
  const series = densify(data, 6);
  if (series.length < 2) return <div style={{ height }} />;
  const color = up ? "var(--pos)" : "var(--neg)";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pad = 7;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * 100;
    const y = 100 - pad - ((v - min) / span) * (100 - pad * 2);
    return [x, y] as const;
  });
  const line = smoothPath(pts);
  const area = `${line} L 100 100 L 0 100 Z`;
  const last = pts[pts.length - 1];
  return (
    <div
      style={{ position: "relative", height }}
      role="img"
      aria-label={label ?? "Price chart"}
    >
      <svg
        width="100%"
        height={height}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={`pc${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((gy) => (
          <line
            key={gy}
            x1="0"
            y1={gy}
            x2="100"
            y2={gy}
            stroke="var(--line)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            opacity="0.45"
          />
        ))}
        <path d={area} fill={`url(#pc${id})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2.4"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* glowing end dot — screen-space so it never distorts under the stretch */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: `${last[0]}%`,
          top: `${last[1]}%`,
          width: 11,
          height: 11,
          marginLeft: -5.5,
          marginTop: -5.5,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 20%, transparent)`,
        }}
      />
    </div>
  );
}

export interface RiskMeterProps {
  /** 1..5 */
  level?: number;
  label?: string;
}

export function RiskMeter({ level = 3, label }: RiskMeterProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            style={{
              width: 22,
              height: 6,
              borderRadius: 3,
              background: i <= level ? "var(--primary)" : "var(--line)",
              transformOrigin: "left center",
              transition: `background .28s var(--ease-out), transform .28s var(--ease-out)`,
              transitionDelay: `${(i - 1) * 0.04}s`,
            }}
          />
        ))}
      </div>
      {label && (
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)" }}>{label}</span>
      )}
    </div>
  );
}

export interface DonutSegment {
  value: number;
  color: string;
}

export interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
}

export function Donut({ segments, size = 116, thickness = 16, center }: DonutProps) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const tot = segments.reduce((s, x) => s + x.value, 0) || 1;
  // Animate the sweep on mount: start collapsed, then grow to full length on the
  // next frame so the ring "draws" in. Respects reduced-motion (renders full).
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDrawn(true);
      return;
    }
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  let off = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={thickness}
        />
        {segments.map((s, i) => {
          const len = (s.value / tot) * c;
          const shown = Math.max(len - 3, 0.5);
          // gap that grows from full (hidden) to the true gap (drawn).
          const dash = drawn ? shown : 0.5;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-off}
              style={{
                transition:
                  "stroke-dasharray .7s var(--ease-out), stroke-dashoffset .7s var(--ease-out)",
                transitionDelay: `${i * 0.07}s`,
              }}
            />
          );
          off += len;
          return el;
        })}
      </svg>
      {center && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
          }}
        >
          {center}
        </div>
      )}
    </div>
  );
}

export interface CountUpProps {
  to: number;
  dur?: number;
  prefix?: string;
  /** Decimal places. */
  dp?: number;
}

// Animated count-up number. Initialises to the final value so a frozen /
// throttled animation clock still shows the correct number.
export function CountUp({ to, dur = 900, prefix = "$", dp = 2 }: CountUpProps) {
  // Initialise to the final value so a frozen/throttled animation clock (offscreen
  // tabs, reduced motion) still shows the correct number.
  const [v, setV] = useState(to);
  useEffect(() => {
    // Respect reduced-motion: snap to the final value, no tween.
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setV(to);
      return;
    }
    let raf = 0;
    let start: number | undefined;
    const from = v;
    const step = (ts: number) => {
      if (start === undefined) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(step);
      else setV(to);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, dur]);
  return (
    <span className="tnum">
      {prefix}
      {v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}
    </span>
  );
}
