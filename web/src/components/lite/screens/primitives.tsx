"use client";

// Tiny shared primitives for the Lite screens — ported from the design handoff
// (the inline Spinner / iconBtn / VeraTag used across onboarding + invest screens).
import { useChain } from "@/lib/chains/active";
import { assetBySymbol } from "@/lib/chains";
import { usePrices } from "@/hooks/usePrices";
import { displayFor } from "@/lib/displayAssets";
import type { CSSProperties } from "react";
import { Icon, VeraOrb, Seal } from "@/components/design";

export function Spinner({ small }: { small?: boolean }) {
  const s = small ? 18 : 22;
  return (
    <span
      className="spin"
      style={{
        width: s,
        height: s,
        borderRadius: "50%",
        border: "2.4px solid color-mix(in srgb, currentColor 35%, transparent)",
        borderTopColor: "currentColor",
        display: "inline-block",
      }}
    />
  );
}

// Three-dot "thinking" indicator — calmer and more intentional than a ring
// spinner for Vera's working states (and it doesn't read as a harsh partial ring).
// Inherits color via currentColor; dots pulse in sequence.
export function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "currentColor",
            opacity: 0.55,
            animation: `dotPulse 1.1s var(--ease-out) ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// Compact prev/next pager for paginated lists (Activity, Transactions).
// Renders nothing for a single page.
export function Pager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  const btn: CSSProperties = {
    width: 48,
    height: 44, // ≥44px touch target
    borderRadius: 13,
    background: "var(--surface-2)",
    display: "grid",
    placeItems: "center",
    color: "var(--ink-2)",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "14px 0 2px" }}>
      <button
        className="tap"
        aria-label="Previous page"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
        style={{ ...btn, opacity: page <= 0 ? 0.4 : 1 }}
      >
        <Icon name="chevL" size={18} />
      </button>
      <span className="tnum" style={{ fontSize: 13, color: "var(--ink-2)", minWidth: 52, textAlign: "center" }}>
        {page + 1} / {pageCount}
      </span>
      <button
        className="tap"
        aria-label="Next page"
        disabled={page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
        style={{ ...btn, opacity: page >= pageCount - 1 ? 0.4 : 1 }}
      >
        <Icon name="chevR" size={18} />
      </button>
    </div>
  );
}

// Quiet sentence-case label above a grouped card (Settings, Autopilot). NOT an
// uppercase tracked eyebrow — that reads as section scaffolding when it sits on
// every group. Keep `.label-eyebrow` for genuine field labels inside cards.
export const sectionLabel: CSSProperties = {
  padding: "0 4px 9px",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-.005em",
  color: "var(--ink-2)",
};

export const iconBtn: CSSProperties = {
  width: 44, // ≥44px touch target (WCAG 2.5.5 / Apple HIG)
  height: 44,
  borderRadius: 99,
  background: "var(--surface-2)",
  display: "grid",
  placeItems: "center",
  color: "var(--ink-2)",
};

// Vera name + orb, optionally with a "verified" trust pill (used on Goal/Plan).
export function VeraTag({ verified = false }: { verified?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <VeraOrb size={26} />
      <span style={{ fontWeight: 700, fontSize: 16 }}>Vera</span>
      {verified && (
        <span style={{ marginLeft: 2, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
          <Seal size={16} /> Verified
        </span>
      )}
    </div>
  );
}

// Venue + live rate for a safe-tier asset ("Aave · 3.8% APY"). Live APY comes
// from /api/prices (Aave Pool read on Base); falls back to the reference rate.
// Renders nothing for assets that don't earn.
export function YieldTag({ symbol, size = "sm" }: { symbol: string; size?: "sm" | "md" }) {
  const chain = useChain();
  const asset = assetBySymbol(chain, symbol);
  const { data } = usePrices();
  const live = data?.prices[symbol]?.apy;
  const ref = displayFor(symbol).apy?.replace("~", "");
  const rate = live !== undefined && Number.isFinite(live) ? `${live.toFixed(1)}%` : ref;
  if (!asset || asset.tier !== "safe" || (!asset.venue && !rate)) return null;
  const md = size === "md";
  return (
    <span
      className="tnum"
      title="Variable rate, can change"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: md ? 26 : 22,
        padding: md ? "0 10px" : "0 8px",
        borderRadius: 99,
        fontSize: md ? 12.5 : 11.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
        background: "var(--accent-soft)",
        color: "var(--accent)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)",
      }}
    >
      {asset.venue}
      {asset.venue && rate ? " · " : ""}
      {rate ? `${rate} APY` : ""}
    </span>
  );
}
