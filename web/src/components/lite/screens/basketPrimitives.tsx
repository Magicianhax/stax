"use client";

// Basket-only presentational bits (tile, weight bar, return chip, share helper).
// Built from the incumbent design primitives (.card/.chip/.skeleton, displayFor
// colors) — nothing here reaches into components/design/*.
import type { CSSProperties } from "react";
import { LogoCluster } from "@/components/design";
import { BasketIconGlyph } from "@/components/BasketIcon";
import { basketShareUrl, riskWord, type Basket } from "@/lib/baskets";
import { useBasketPerformance } from "@/hooks/useBasketPerformance";

/**
 * Fixed brand ramp for allocation colours (weight bars, the Owned donut + legend):
 * primary, accent, ink-3, terracotta-soft. Cycles with a lighter pass past four so
 * the brand green is never doubled next to itself.
 */
export const BRAND_RAMP = [
  "var(--primary)",
  "var(--accent)",
  "var(--ink-3)",
  "color-mix(in srgb, var(--neg) 58%, var(--surface))",
] as const;
export function rampColor(i: number): string {
  const c = BRAND_RAMP[i % BRAND_RAMP.length];
  return i < BRAND_RAMP.length ? c : `color-mix(in srgb, ${c} 55%, var(--surface-2))`;
}

/** The holdings of a basket as LogoCluster input (heaviest first). */
export function clusterOf(basket: { items: { symbol: string; weightPct: number }[] }): { symbol: string }[] {
  return [...basket.items].sort((a, b) => b.weightPct - a.weightPct).map((i) => ({ symbol: i.symbol }));
}

/** Emoji on a tinted disc — the basket's glyph. Tint is the basket color, never a raw fill. */
export function BasketDisc({ basket, size = 48 }: { basket: Basket; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        flex: "none",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        background: `color-mix(in srgb, ${basket.color} 16%, var(--surface-2))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${basket.color} 22%, transparent)`,
      }}
    >
      <BasketIconGlyph icon={basket.icon} size={Math.round(size * 0.46)} color={basket.color} />
    </span>
  );
}

// PlanScreen keeps the shared, display-coloured, animating bar; baskets use the ramp one below.
export { usePrefersReducedMotion, WeightBar } from "@/components/WeightBar";

const SEG_GAP = 2;

/** Stacked weight bar coloured from the brand ramp (heaviest holding = primary). Static: baskets never morph. */
export function RampWeightBar({
  items,
  height = 8,
}: {
  items: { symbol: string; weightPct: number }[];
  height?: number;
}) {
  const order = [...items].sort((a, b) => b.weightPct - a.weightPct);
  const gaps = Math.max(0, order.length - 1) * SEG_GAP;
  // Cumulative start (%) of each segment.
  const starts = order.map((_, idx) => order.slice(0, idx).reduce((sum, x) => sum + x.weightPct, 0));
  return (
    <div aria-hidden style={{ position: "relative", height, borderRadius: 99, overflow: "hidden", width: "100%", background: "var(--surface-2)" }}>
      {order.map((i, idx) => {
        const left = starts[idx];
        return (
          <span
            key={i.symbol}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `calc(100% - ${gaps}px)`,
              background: rampColor(idx),
              transformOrigin: "left center",
              transform: `translateX(calc(${left}% + ${idx * SEG_GAP}px)) scaleX(${i.weightPct / 100})`,
            }}
          />
        );
      })}
    </div>
  );
}

/** Signed percent, tabular. */
export function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
}

/**
 * A return chip that never lies: a number when we have one for every holding,
 * a shimmer while loading, and honest words otherwise.
 */
export function ReturnChip({
  value,
  loading,
  label,
  size = "sm",
}: {
  value: number | null;
  loading?: boolean;
  label: string;
  size?: "sm" | "md";
}) {
  const md = size === "md";
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 5,
    height: md ? 34 : 26,
    padding: md ? "0 12px" : "0 9px",
    borderRadius: 99,
    fontSize: md ? 14 : 12.5,
    fontWeight: 700,
    whiteSpace: "nowrap",
    flex: "none",
  };
  if (loading) {
    return <span className="skeleton" style={{ ...base, width: md ? 92 : 72, display: "inline-block" }} aria-label={`${label} return loading`} />;
  }
  if (value === null) {
    return (
      <span style={{ ...base, background: "var(--surface-2)", color: "var(--ink-2)", fontWeight: 600 }}>
        {label} · not enough history yet
      </span>
    );
  }
  const up = value >= 0;
  const tone = up ? "var(--pos)" : "var(--neg)";
  return (
    <span
      className="tnum"
      style={{
        ...base,
        background: `color-mix(in srgb, ${tone} 13%, var(--surface))`,
        color: "var(--ink)",
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 28%, transparent)`,
      }}
    >
      <span style={{ color: tone }}>{fmtPct(value)}</span>
      <span style={{ fontSize: md ? 12 : 11, fontWeight: 600, color: "var(--ink-2)" }}>{label}</span>
    </span>
  );
}

/** Full-width basket tile for the Baskets screen: disc, name, tagline, weight bar, 1M chip, risk word. */
export function BasketTile({ basket, onClick }: { basket: Basket; onClick: () => void }) {
  const perf = useBasketPerformance(basket);
  return (
    <button
      onClick={onClick}
      className="card tap"
      aria-label={`${basket.name}. ${basket.tagline} ${riskWord(basket.riskScore)}.`}
      style={{ width: "100%", textAlign: "left", padding: "14px 16px 14px 14px", marginBottom: 10, display: "block" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16.5, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {basket.name}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {basket.tagline}
          </div>
        </div>
        <LogoCluster assets={clusterOf(basket)} size={28} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RampWeightBar items={basket.items} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", flex: "none" }}>
          {riskWord(basket.riskScore)}
        </span>
        <ReturnChip value={perf.returns["1M"]} loading={perf.loading} label="1M" />
      </div>
    </button>
  );
}

/** Compact tile for the Home rail (fixed width, scrolls horizontally). */
export function BasketRailTile({ basket, onClick }: { basket: Basket; onClick: () => void }) {
  const perf = useBasketPerformance(basket);
  return (
    <button
      onClick={onClick}
      className="card tap"
      aria-label={`${basket.name}, ${riskWord(basket.riskScore)}`}
      style={{ width: 164, flex: "none", textAlign: "left", padding: 14, display: "block", scrollSnapAlign: "start" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <LogoCluster assets={clusterOf(basket)} size={26} max={3} />
        <ReturnChip value={perf.returns["1M"]} loading={perf.loading} label="1M" />
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.01em", marginTop: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {basket.name}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>{riskWord(basket.riskScore)}</div>
      <div style={{ marginTop: 10 }}>
        <RampWeightBar items={basket.items} height={6} />
      </div>
    </button>
  );
}

/**
 * Share a basket: the native share sheet on phones, else copy the link.
 * `url` defaults to the self-contained encoded link; pass a short `/app?b=` link when
 * the basket was saved to the server. Resolves to what happened so the caller can toast honestly.
 */
export async function shareBasket(basket: Basket, url: string = basketShareUrl(basket)): Promise<"shared" | "copied" | "failed"> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav?.share && /Android|iPhone|iPad/i.test(nav.userAgent)) {
    try {
      await nav.share({ title: `${basket.name} · Stax`, text: basket.tagline, url });
      return "shared";
    } catch {
      /* user dismissed or share unsupported — fall through to copy */
    }
  }
  try {
    await nav?.clipboard?.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
