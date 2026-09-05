"use client";

// Leaf component: the stacked weight bar + the reduced-motion hook it needs.
// Depends only on react + displayAssets so the marketing site can import it
// without dragging the app screens, demo provider, or react-query into its bundle.
import { useSyncExternalStore } from "react";
import { displayFor } from "@/lib/displayAssets";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia?.(REDUCED_MOTION);
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
}
/** True when the viewer asked for reduced motion (server snapshot: false). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => Boolean(window.matchMedia?.(REDUCED_MOTION).matches),
    () => false,
  );
}

const SEG_GAP = 2;

/**
 * Stacked weight bar, colored per holding from the display registry. Shared by
 * PlanScreen's allocation bar and the basket tiles. Segments are positioned with
 * transforms only (translateX + scaleX), so a recomposed plan morphs without
 * animating layout. Each segment's own width is the bar minus the gaps, which
 * makes the percentage translate land exactly after the previous scaled segments;
 * the gaps are added in px on top, so they stay a crisp 2px at any weight.
 */
export function WeightBar({
  items,
  height = 8,
  animate = false,
}: {
  items: { symbol: string; weightPct: number }[];
  height?: number;
  /** Transition segment positions (Plan's "rethinking" morph). Off under reduced motion. */
  animate?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const gaps = Math.max(0, items.length - 1) * SEG_GAP;
  // Cumulative start (%) of each segment.
  const starts = items.reduce<number[]>((acc, i) => [...acc, (acc[acc.length - 1] ?? 0) + i.weightPct], []).map((end, idx) => end - items[idx].weightPct);
  return (
    <div
      aria-hidden
      style={{ position: "relative", height, borderRadius: 99, overflow: "hidden", width: "100%" }}
    >
      {items.map((i, idx) => {
        const d = displayFor(i.symbol);
        const start = starts[idx];
        return (
          <span
            key={i.symbol}
            title={`${d.name} ${i.weightPct}%`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `calc(100% - ${gaps}px)`,
              background: d.color,
              transformOrigin: "left center",
              transform: `translateX(calc(${start}% + ${idx * SEG_GAP}px)) scaleX(${i.weightPct / 100})`,
              transition: animate && !reduced ? "transform .45s var(--ease-out)" : "none",
              willChange: animate ? "transform" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
