"use client";

// Stax data-viz primitives — ported from the design handoff (components.jsx).
// Sparkline, PriceChart, RangeChips, Bars, ProjectionChart, RiskMeter, Donut,
// CountUp. Presentational + reusable. Deterministic demo inputs live in
// lib/demoSeries.ts. API reference: docs/superpowers/specs/2026-09-07-motion-kit-api.md
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import gsap from "gsap";
import { reducedMotion } from "../motion/reduced";

// ── shared helpers ───────────────────────────────────────────────────────────

/** false on first paint, true on the next frame — drives mount-draw transitions. */
function useDrawn(): boolean {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return drawn;
}

/**
 * Morph an SVG path: whenever `d` changes, tween the element's `d` attribute
 * from what is currently on screen to the new value (GSAP attr, 0.5 s). Both
 * values must share the same command structure (see `resample`). Keyed on the
 * string so unrelated re-renders never restart or kill a tween.
 */
function useMorphD(ref: React.RefObject<SVGPathElement | null>, d: string, duration = 0.5) {
  const shown = useRef<string | null>(null);
  const tween = useRef<gsap.core.Tween | null>(null);
  useLayoutEffect(() => {
    if (!d) return;
    const from = shown.current;
    if (from === null) {
      shown.current = d;
      return;
    }
    const el = ref.current;
    if (from === d || !el) return;
    tween.current?.kill();
    tween.current = gsap.fromTo(
      el,
      { attr: { d: from } },
      {
        attr: { d },
        duration: reducedMotion() ? 0 : duration,
        ease: "power2.inOut",
        onUpdate() {
          shown.current = el.getAttribute("d") ?? d;
        },
        onComplete() {
          shown.current = d;
        },
      },
    );
  }, [d, duration, ref]);
  useEffect(
    () => () => {
      tween.current?.kill();
    },
    [],
  );
}

export interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  /** Thicker stroke + filled area gradient. */
  strong?: boolean;
  /** Soft area under the line (lighter than `strong`). */
  fill?: boolean;
}

// Draws its line on mount (stroke-dash, 0.7 s); the area fades in behind it.
export function Sparkline({
  data,
  w = 64,
  h = 24,
  color = "var(--pos)",
  strong = false,
  fill = false,
}: SparklineProps) {
  const id = useId().replace(/:/g, "");
  const drawn = useDrawn();
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
  const showArea = strong || fill;
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
      {showArea && (
        <path
          d={area}
          fill={`url(#sp${id})`}
          style={{ opacity: drawn ? 1 : 0, transition: "opacity .6s var(--ease-out) .2s" }}
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strong ? 2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        style={{
          strokeDasharray: 1,
          strokeDashoffset: drawn ? 0 : 1,
          transition: "stroke-dashoffset .7s var(--ease-out)",
        }}
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
  /** Gradient fill under the line (line colour at 22% → 0). Default true. */
  area?: boolean;
  /** Pixel height. */
  height?: number;
  /** Range chips rendered under the chart (RangeChips); all three go together. */
  ranges?: readonly string[];
  range?: string;
  onRange?: (range: string) => void;
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
  area = true,
  height = 210,
  ranges,
  range,
  onRange,
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

  // ── morph: tween the on-screen path into the new one; the end dot follows ──
  const lineRef = useRef<SVGPathElement | null>(null);
  const areaRef = useRef<SVGPathElement | null>(null);
  const dotRef = useRef<HTMLSpanElement | null>(null);
  const lineD = geom?.line ?? "";
  const areaD = geom?.area ?? "";
  const lastX = geom?.last[0] ?? 0;
  const lastY = geom?.last[1] ?? 0;
  useMorphD(lineRef, lineD);
  useMorphD(areaRef, areaD);
  const dotShown = useRef<readonly [number, number] | null>(null);
  useLayoutEffect(() => {
    if (!lineD) return;
    const from = dotShown.current;
    dotShown.current = [lastX, lastY];
    const el = dotRef.current;
    if (!from || !el) return;
    gsap.fromTo(
      el,
      { left: `${from[0]}%`, top: `${from[1]}%` },
      { left: `${lastX}%`, top: `${lastY}%`, duration: reducedMotion() ? 0 : 0.5, ease: "power2.inOut", overwrite: true },
    );
  }, [lineD, lastX, lastY]);

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
  // Current index lives in a ref too so onScrub fires from the event handler,
  // never from inside a state updater (parents typically pass a setState).
  const idxRef = useRef<number | null>(null);
  const setIndex = useCallback(
    (i: number | null) => {
      if (idxRef.current === i) return;
      idxRef.current = i;
      setScrub(i);
      scrubRef.current?.(i === null ? null : { ...src[i], index: i });
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

  const chips = ranges && range !== undefined && onRange ? (
    <RangeChips values={ranges} value={range} onChange={onRange} style={{ marginTop: 14 }} />
  ) : null;

  if (!geom) {
    return (
      <div>
        <div style={{ height }} />
        {chips}
      </div>
    );
  }

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
    <div>
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
            <stop offset="0%" stopColor={color} stopOpacity="0.22" style={{ transition: "stop-color .5s var(--ease-out)" }} />
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
        <path ref={areaRef} d={geom.area} fill={area ? `url(#pc${id})` : "none"} />
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
    {chips}
    </div>
  );
}

// ── Range chips ──────────────────────────────────────────────────────────────
// The one segmented range picker every chart uses: pill track, sliding thumb,
// arrow-key navigation (radiogroup semantics).
//
//   <RangeChips values={["1D", "1W", "1M", "1Y", "All"]} value={r} onChange={setR} />
export interface RangeChipsProps {
  values: readonly string[];
  value: string;
  onChange: (value: string) => void;
  /** Chip height in px (default 32). */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function RangeChips({ values, value, onChange, size = 32, className, style }: RangeChipsProps) {
  const idx = Math.max(values.indexOf(value), 0);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % values.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + values.length) % values.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = values.length - 1;
    else return;
    e.preventDefault();
    onChange(values[next]);
    const btn = e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next];
    btn?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Range"
      className={`seg${className ? ` ${className}` : ""}`}
      onKeyDown={onKey}
      style={{ background: "var(--surface-2)", ...style }}
    >
      <span
        aria-hidden
        className="seg-thumb"
        style={{
          width: `calc((100% - 8px) / ${values.length})`,
          left: 4,
          transform: `translateX(calc(${idx} * 100%))`,
        }}
      />
      {values.map((v, i) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={i === idx}
          tabIndex={i === idx ? 0 : -1}
          onClick={() => onChange(v)}
          className={`seg-item${i === idx ? " is-on" : ""}`}
          style={{ height: size, fontSize: 13 }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ── Bars ─────────────────────────────────────────────────────────────────────
// Small bar chart (cash in/out by week, etc). Bars grow from the baseline on
// mount with a 30 ms stagger; positive/negative tones; tap a bar to read it.
//
//   <Bars data={weeks.map(w => ({ label: "Sep 1", value: w.v }))} height={120} />
export interface BarDatum {
  label: string;
  value: number;
  /** Colour override; default follows the sign of `value`. */
  tone?: "pos" | "neg" | "neutral";
}

export interface BarsProps {
  data: BarDatum[];
  /** Pixel height of the bar area (labels sit below it). */
  height?: number;
  /** Always show each bar's value (otherwise only the tapped bar shows it). */
  showValues?: boolean;
  formatValue?: (v: number) => string;
  /** SR description. */
  label?: string;
}

const TONE: Record<NonNullable<BarDatum["tone"]>, string> = {
  pos: "var(--primary)",
  neg: "var(--neg)",
  neutral: "var(--ink-3)",
};

const fmtSignedUsd = (v: number) => `${v < 0 ? "−" : "+"}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function Bars({ data, height = 120, showValues = false, formatValue = fmtSignedUsd, label }: BarsProps) {
  const drawn = useDrawn();
  const [picked, setPicked] = useState<number | null>(null);
  const maxPos = Math.max(0, ...data.map((d) => d.value));
  const maxNeg = Math.max(0, ...data.map((d) => -d.value));
  const total = maxPos + maxNeg || 1;
  // Baseline position as a fraction of the height (all-positive data → 1).
  const base = maxPos / total;
  const reading = picked !== null ? data[picked] : null;
  return (
    <div role="img" aria-label={label ?? "Bar chart"} style={{ position: "relative" }}>
      <div
        aria-live="polite"
        className="tnum"
        style={{
          height: 18,
          marginBottom: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--ink-2)",
          opacity: reading ? 1 : 0,
          transition: "opacity .2s var(--ease-out)",
        }}
      >
        {reading ? `${reading.label} · ${formatValue(reading.value)}` : "\u00a0"}
      </div>
      <div style={{ position: "relative", height }}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: base * height - 0.5,
            height: 1,
            background: "var(--line)",
          }}
        />
        <div style={{ display: "flex", gap: 6, height: "100%", alignItems: "stretch" }}>
          {data.map((d, i) => {
            const tone = d.tone ?? (d.value > 0 ? "pos" : d.value < 0 ? "neg" : "neutral");
            const h = (Math.abs(d.value) / total) * height;
            const positive = d.value >= 0;
            const on = picked === i;
            return (
              <button
                key={i}
                type="button"
                aria-label={`${d.label}: ${formatValue(d.value)}`}
                aria-pressed={on}
                onClick={() => setPicked(on ? null : i)}
                style={{
                  flex: 1,
                  position: "relative",
                  minWidth: 0,
                  background: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {(showValues || on) && d.value !== 0 && (
                  <span
                    className="tnum"
                    style={{
                      position: "absolute",
                      left: "50%",
                      transform: "translateX(-50%)",
                      top: positive ? base * height - h - 16 : base * height + h + 3,
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: on ? "var(--ink)" : "var(--ink-3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatValue(d.value)}
                  </span>
                )}
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 2,
                    right: 2,
                    top: positive ? base * height - Math.max(h, 2) : base * height,
                    height: Math.max(h, 2),
                    borderRadius: 4,
                    background: TONE[tone],
                    opacity: on ? 1 : picked === null ? 0.85 : 0.45,
                    transformOrigin: positive ? "50% 100%" : "50% 0%",
                    transform: drawn ? "scaleY(1)" : "scaleY(0)",
                    transition: `transform .5s var(--ease-out) ${i * 0.03}s, opacity .2s var(--ease-out)`,
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {data.map((d, i) => (
          <span
            key={i}
            className="tnum"
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "center",
              fontSize: 10.5,
              fontWeight: 600,
              color: picked === i ? "var(--ink)" : "var(--ink-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Projection chart ─────────────────────────────────────────────────────────
// Contributed vs projected value over N months: projected as a gradient area +
// line, contributions as a dashed line. Paths morph when the inputs change.
//
//   const { contributed, projected } = projection({ amount, cadence, riskBps, months });
//   <ProjectionChart contributed={contributed} projected={projected} height={150} />
export interface ProjectionChartProps {
  contributed: PricePoint[];
  projected: PricePoint[];
  height?: number;
  formatValue?: (v: number) => string;
  label?: string;
}

const fmtUsd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export function ProjectionChart({
  contributed,
  projected,
  height = 150,
  formatValue = fmtUsd0,
  label,
}: ProjectionChartProps) {
  const id = useId().replace(/:/g, "");
  const pad = 10;
  const geom = useMemo(() => {
    const c = resample(contributed.map((p) => p.v));
    const v = resample(projected.map((p) => p.v));
    if (c.length < 2 || v.length < 2) return null;
    const max = Math.max(...v, ...c) || 1;
    const toPts = (arr: number[]) =>
      arr.map((y, i) => [(i / (arr.length - 1)) * 100, 100 - pad - (y / max) * (100 - pad)] as const);
    const vp = toPts(v);
    const cp = toPts(c);
    const line = smoothPath(vp);
    return { line, area: `${line} L 100 100 L 0 100 Z`, dashed: smoothPath(cp), max };
  }, [contributed, projected]);
  const lineRef = useRef<SVGPathElement | null>(null);
  const areaRef = useRef<SVGPathElement | null>(null);
  const dashRef = useRef<SVGPathElement | null>(null);
  useMorphD(lineRef, geom?.line ?? "");
  useMorphD(areaRef, geom?.area ?? "");
  useMorphD(dashRef, geom?.dashed ?? "");
  if (!geom) return <div style={{ height }} />;
  const endV = projected[projected.length - 1]?.v ?? 0;
  const endC = contributed[contributed.length - 1]?.v ?? 0;
  const months = projected.length - 1;
  return (
    <div role="img" aria-label={label ?? `Projected ${formatValue(endV)} after ${months} months, ${formatValue(endC)} contributed`}>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
          <span aria-hidden style={{ width: 10, height: 3, borderRadius: 2, background: "var(--primary)" }} />
          Projected <span className="tnum" style={{ color: "var(--ink)" }}>{formatValue(endV)}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
          <span aria-hidden style={{ width: 10, height: 0, borderTop: "2px dashed var(--ink-3)" }} />
          Put in <span className="tnum" style={{ color: "var(--ink)" }}>{formatValue(endC)}</span>
        </span>
      </div>
      <div style={{ position: "relative", height }}>
        <svg
          width="100%"
          height={height}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          style={{ display: "block", overflow: "visible" }}
        >
          <defs>
            <linearGradient id={`pj${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[33, 66].map((gy) => (
            <line key={gy} x1="0" y1={gy} x2="100" y2={gy} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.45" />
          ))}
          <path ref={areaRef} d={geom.area} fill={`url(#pj${id})`} />
          <path
            ref={dashRef}
            d={geom.dashed}
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth="1.6"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
          <path
            ref={lineRef}
            d={geom.line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/* scale cue: the top of the chart */}
        <span
          aria-hidden
          className="tnum"
          style={{ position: "absolute", left: 0, top: `${pad}%`, transform: "translateY(-100%)", fontSize: 10.5, fontWeight: 600, color: "var(--ink-3)" }}
        >
          {formatValue(geom.max)}
        </span>
      </div>
      <div className="tnum" style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, fontWeight: 600, color: "var(--ink-3)" }}>
        <span>Today</span>
        <span>{months} months</span>
      </div>
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
