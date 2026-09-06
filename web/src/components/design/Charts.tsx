"use client";

// Stax data-viz primitives — ported from the design handoff (components.jsx).
// Sparkline, PriceChart, RiskMeter, Donut, CountUp. Presentational + reusable.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { reducedMotion } from "../motion/reduced";

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
// A full-width area chart for the asset / basket detail screens. Smooth
// Catmull-Rom curve, gradient area, faint gridlines, glowing end dot, min/max
// labels, a scrub readout (crosshair + price/date pill), and a path morph when
// the data changes (GSAP `attr` tween on `d`, 0.5 s). The line colour follows `up`.
//
//   <PriceChart data={[…]} up height={216} label="…" />
//   <PriceChart points={[{ t: 1725660000000, v: 231.48 }, …]} up onScrub={setPt} />
//
// Props: data (bare numbers) OR points ({ t, v }[]; `t` a ms timestamp or a
// label string, shown in the readout), up, height, label (SR description),
// onScrub(point | null), formatValue, formatTime.

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
// The wobble is zero at the source points so they stay exact for the readout.
function densify(src: number[], steps = 6): number[] {
  if (src.length < 2 || steps < 2) return src;
  const out: number[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const e = t * t * (3 - 2 * t); // smoothstep
      const wob = Math.sin((i * steps + s) * 1.7) * (Math.abs(b - a) * 0.14 + 0.05) * Math.sin(Math.PI * t);
      out.push(a + (b - a) * e + wob);
    }
  }
  out.push(src[src.length - 1]);
  return out;
}

// Resample to a fixed point count (linear) so every path has the same command
// structure and GSAP can tween `d` between datasets.
const PATH_POINTS = 61;
function resample(src: number[], n = PATH_POINTS): number[] {
  if (src.length < 2) return src;
  if (src.length === n) return src;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (src.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, src.length - 1);
    out.push(src[lo] + (src[hi] - src[lo]) * (pos - lo));
  }
  return out;
}

export interface PricePoint {
  /** ms timestamp, or a ready-made label. */
  t: number | string;
  v: number;
}

export interface PriceChartProps {
  data?: number[];
  /** Alternative to `data`: timed points so the readout can show dates. */
  points?: PricePoint[];
  /** Up = positive (green) / down = negative (red) coloring. */
  up?: boolean;
  /** Pixel height. */
  height?: number;
  /** Screen-reader description of the trend (charts are otherwise invisible to SR). */
  label?: string;
  /** Fires with the scrubbed point (source index) or null when the scrub ends. */
  onScrub?: (point: (PricePoint & { index: number }) | null) => void;
  formatValue?: (v: number) => string;
  formatTime?: (t: number | string) => string;
}

const fmtUsd = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function defaultTime(t: number | string, spanMs: number): string {
  if (typeof t === "string") return t;
  const d = new Date(t < 1e12 ? t * 1000 : t);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (spanMs > 3 * 86400e3) return day;
  return `${day} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function PriceChart({
  data,
  points,
  up = true,
  height = 210,
  label,
  onScrub,
  formatValue = fmtUsd,
  formatTime,
}: PriceChartProps) {
  const id = useId().replace(/:/g, "");
  const src: PricePoint[] = useMemo(
    () => points ?? (data ?? []).map((v, i) => ({ t: i, v })),
    [points, data],
  );
  const values = useMemo(() => src.map((p) => p.v), [src]);
  // Short series get densified for a live-looking line; long ones are drawn as-is.
  const steps = values.length < 40 ? 6 : 1;
  const series = useMemo(() => resample(densify(values, steps)), [values, steps]);

  const color = up ? "var(--pos)" : "var(--neg)";
  const pad = 12; // % of height kept clear for the min/max labels
  const geom = useMemo(() => {
    if (series.length < 2) return null;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const pts = series.map((v, i) => {
      const x = (i / (series.length - 1)) * 100;
      const y = 100 - pad - ((v - min) / span) * (100 - pad * 2);
      return [x, y] as const;
    });
    const line = smoothPath(pts);
    const area = `${line} L 100 100 L 0 100 Z`;
    // Source-point → screen position (source i sits at dense index i*steps, then
    // resampled: map by fraction).
    const at = (i: number) => {
      const f = values.length > 1 ? i / (values.length - 1) : 0;
      const k = Math.round(f * (pts.length - 1));
      return pts[k];
    };
    let iMin = 0;
    let iMax = 0;
    values.forEach((v, i) => {
      if (v < values[iMin]) iMin = i;
      if (v > values[iMax]) iMax = i;
    });
    return { pts, line, area, at, iMin, iMax, last: pts[pts.length - 1] };
  }, [series, values]);

  // ── morph: tween the on-screen path into the new one ──
  // Keyed on the path string (not the geom object) so unrelated re-renders never
  // restart or kill the tween; an interrupted morph continues from wherever the
  // line currently is.
  const lineRef = useRef<SVGPathElement | null>(null);
  const areaRef = useRef<SVGPathElement | null>(null);
  const dotRef = useRef<HTMLSpanElement | null>(null);
  const shown = useRef<{ line: string; area: string; last: readonly [number, number] } | null>(null);
  const tweens = useRef<gsap.core.Tween[]>([]);
  const line = geom?.line ?? "";
  const area = geom?.area ?? "";
  const lastX = geom?.last[0] ?? 0;
  const lastY = geom?.last[1] ?? 0;
  useLayoutEffect(() => {
    if (!line) return;
    const from = shown.current;
    const to = { line, area, last: [lastX, lastY] as const };
    if (!from) {
      shown.current = to;
      return;
    }
    if (from.line === line || !lineRef.current || !areaRef.current) return;
    tweens.current.forEach((t) => t.kill());
    const dur = reducedMotion() ? 0 : 0.5;
    const ease = "power2.inOut";
    const cur = { ...from };
    shown.current = cur;
    tweens.current = [
      gsap.fromTo(lineRef.current, { attr: { d: from.line } }, {
        attr: { d: line },
        duration: dur,
        ease,
        onUpdate() {
          cur.line = lineRef.current?.getAttribute("d") ?? line;
        },
        onComplete() {
          cur.line = line;
        },
      }),
      gsap.fromTo(areaRef.current, { attr: { d: from.area } }, {
        attr: { d: area },
        duration: dur,
        ease,
        onUpdate() {
          cur.area = areaRef.current?.getAttribute("d") ?? area;
        },
        onComplete() {
          cur.area = area;
        },
      }),
    ];
    if (dotRef.current) {
      tweens.current.push(
        gsap.fromTo(
          dotRef.current,
          { left: `${from.last[0]}%`, top: `${from.last[1]}%` },
          {
            left: `${lastX}%`,
            top: `${lastY}%`,
            duration: dur,
            ease,
            onUpdate() {
              const el = dotRef.current;
              if (el) cur.last = [parseFloat(el.style.left), parseFloat(el.style.top)];
            },
          },
        ),
      );
    }
  }, [line, area, lastX, lastY]);
  useEffect(() => () => tweens.current.forEach((t) => t.kill()), []);

  // ── scrub ──
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  // Readout pill width, measured on commit so it can clamp inside the chart.
  const [pillW, setPillW] = useState(120);
  const measurePill = (el: HTMLDivElement | null) => {
    if (el && el.offsetWidth) setPillW(el.offsetWidth);
  };
  const [scrub, setScrub] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scrubRef = useRef(onScrub);
  useEffect(() => {
    scrubRef.current = onScrub;
  }, [onScrub]);
  const setIndex = useCallback(
    (i: number | null) => {
      setScrub((cur) => {
        if (cur === i) return cur;
        scrubRef.current?.(i === null ? null : { ...src[i], index: i });
        return i;
      });
    },
    [src],
  );
  const move = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el || values.length < 2) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    setIndex(Math.round(f * (values.length - 1)));
  };
  const end = () => setIndex(null);

  if (!geom) return <div style={{ height }} />;

  const spanMs =
    typeof src[0]?.t === "number" && typeof src[src.length - 1]?.t === "number"
      ? Math.abs((src[src.length - 1].t as number) - (src[0].t as number)) * (src[0].t < 1e12 ? 1000 : 1)
      : 0;
  const timeText = (t: number | string) => (formatTime ? formatTime(t) : defaultTime(t, spanMs));
  const hasTime = points !== undefined;

  // Screen-space helpers (the SVG is stretched, so labels live outside it).
  const px = (xPct: number) => (xPct / 100) * width;
  const py = (yPct: number) => (yPct / 100) * height;
  const clampX = (x: number, w: number) => Math.min(Math.max(x, w / 2), Math.max(width - w / 2, w / 2));

  const sp = scrub !== null ? geom.at(scrub) : null;
  const minP = geom.at(geom.iMin);
  const maxP = geom.at(geom.iMax);

  const extreme = (p: readonly [number, number], v: number, above: boolean) => (
    <span
      aria-hidden
      className="tnum"
      style={{
        position: "absolute",
        left: clampX(px(p[0]), 56),
        top: above ? py(p[1]) - 16 : py(p[1]) + 6,
        transform: "translateX(-50%)",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--ink-3)",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        opacity: scrub === null ? 1 : 0.35,
        transition: "opacity .2s var(--ease-out)",
      }}
    >
      {formatValue(v)}
    </span>
  );

  return (
    <div
      ref={box}
      style={{ position: "relative", height, touchAction: "pan-y", userSelect: "none" }}
      role="img"
      aria-label={label ?? "Price chart"}
      onPointerDown={move}
      onPointerMove={move}
      onPointerUp={(e) => {
        if (e.pointerType !== "mouse") end();
      }}
      onPointerLeave={end}
      onPointerCancel={end}
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
            <stop offset="0%" stopColor={color} stopOpacity="0.3" style={{ transition: "stop-color .5s var(--ease-out)" }} />
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
        <path ref={areaRef} d={geom.area} fill={`url(#pc${id})`} />
        <path
          ref={lineRef}
          d={geom.line}
          fill="none"
          stroke={color}
          strokeWidth="2.4"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: "stroke .5s var(--ease-out)" }}
        />
      </svg>

      {/* min / max at the extremes */}
      {width > 0 && geom.iMin !== geom.iMax && (
        <>
          {extreme(maxP, values[geom.iMax], true)}
          {extreme(minP, values[geom.iMin], false)}
        </>
      )}

      {/* glowing end dot — screen-space so it never distorts under the stretch */}
      <span
        ref={dotRef}
        aria-hidden
        style={{
          position: "absolute",
          left: `${geom.last[0]}%`,
          top: `${geom.last[1]}%`,
          width: 11,
          height: 11,
          marginLeft: -5.5,
          marginTop: -5.5,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 20%, transparent)`,
          opacity: scrub === null ? 1 : 0,
          transition: "opacity .2s var(--ease-out), background .5s var(--ease-out)",
        }}
      />

      {/* scrub: crosshair + dot + readout pill */}
      {sp && scrub !== null && width > 0 && (
        <>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: px(sp[0]),
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--ink-3)",
              opacity: 0.5,
              pointerEvents: "none",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: px(sp[0]) - 5.5,
              top: py(sp[1]) - 5.5,
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: color,
              boxShadow: "0 0 0 2.5px var(--surface)",
              pointerEvents: "none",
            }}
          />
          <div
            ref={measurePill}
            className="tnum"
            style={{
              position: "absolute",
              left: clampX(px(sp[0]), pillW),
              top: Math.max(py(sp[1]) - 46, 0),
              transform: "translateX(-50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
              padding: "5px 10px",
              borderRadius: 10,
              background: "var(--surface)",
              boxShadow: "inset 0 0 0 1px var(--line), var(--shadow)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              lineHeight: 1.15,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>
              {formatValue(values[scrub])}
            </span>
            {hasTime && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)" }}>
                {timeText(src[scrub].t)}
              </span>
            )}
          </div>
        </>
      )}
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
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  // Running start offset for each segment.
  const offsets = segments.reduce<number[]>((acc, seg, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + (segments[i - 1].value / tot) * c);
    return acc;
  }, []);
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
          return (
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
              strokeDashoffset={-offsets[i]}
              style={{
                transition:
                  "stroke-dasharray .7s var(--ease-out), stroke-dashoffset .7s var(--ease-out)",
                transitionDelay: `${i * 0.07}s`,
              }}
            />
          );
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
    let raf = 0;
    let start: number | undefined;
    const from = v;
    if (reducedMotion()) {
      raf = requestAnimationFrame(() => setV(to));
      return () => cancelAnimationFrame(raf);
    }
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
