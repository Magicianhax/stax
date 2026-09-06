"use client";

// Stax brand marks — ported from the design handoff (icons.jsx).
// StaxMark (wordmark glyph), VeraOrb (the assistant's gradient orb presence),
// AssetTile (real logo on a white tile, monogram fallback) and LogoCluster
// (overlapping tiles with a "+N" disc).
import { useState } from "react";
import { toTile } from "@/lib/displayAssets";

export interface StaxMarkProps {
  size?: number;
  color?: string;
}

// Stax glyph — three stacked bars rising (a "stack").
export function StaxMark({ size = 28, color = "var(--primary)" }: StaxMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block" }}>
      <rect x="6" y="19" width="20" height="5" rx="2.5" fill={color} opacity="0.4" />
      <rect x="6" y="12" width="20" height="5" rx="2.5" fill={color} opacity="0.7" />
      <rect x="6" y="5" width="20" height="5" rx="2.5" fill={color} />
    </svg>
  );
}

export interface VeraOrbProps {
  size?: number;
  /** Breathing animation — a calm idle/working presence. */
  pulse?: boolean;
  /** Kept for API compatibility; no longer renders rings. */
  thinking?: boolean;
}

// Vera — the assistant's presence: a glassy, iridescent sphere (real rendered
// asset at /brand/vera.png). Breathes gently when `pulse`.
export function VeraOrb({ size = 36, pulse = false }: VeraOrbProps) {
  return (
    <img
      src="/brand/vera.png"
      alt=""
      width={size}
      height={size}
      decoding="async"
      style={{
        width: size,
        height: size,
        display: "block",
        flex: "none",
        borderRadius: "50%",
        animation: pulse ? "spin 8s linear infinite" : "none",
      }}
    />
  );
}

// Minimal shape an AssetTile needs. Real asset objects (from lib/chains) are
// adapted to this in the screen layer (lib/displayAssets).
export interface TileAsset {
  name: string;
  /** Background color for the tile. */
  color: string;
  /** Optional single-letter glyph; falls back to the first letter of `name`. */
  glyph?: string;
  /** "safe" tiles always render a "$". */
  kind?: string;
  /** Optional brand logo URL — rendered on a white tile, falls back to monogram on error. */
  logo?: string;
}

export interface AssetTileProps {
  asset: TileAsset;
  size?: number;
  radius?: number;
}

// Brand tile — renders the real brand logo on a clean white tile when `asset.logo`
// is set (falling back to the colored monogram if the image fails to load), and
// the colored monogram lettermark otherwise.
export function AssetTile({ asset, size = 44, radius }: AssetTileProps) {
  const letter = asset.glyph || asset.name[0] || "?";
  const fs = size * 0.4;
  const br = radius ?? size * 0.295;
  const [imgFailed, setImgFailed] = useState(false);

  if (asset.logo && !imgFailed) {
    // Company logo PNGs are full-bleed branded icon squares, so fill the tile and
    // let the rounded tile clip them — uniform "app-icon" tiles across the set.
    return (
      <div
        className="tile"
        style={{
          width: size,
          height: size,
          background: "#fff",
          borderRadius: br,
          overflow: "hidden",
          padding: 0,
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,.06)",
        }}
      >
        <img
          src={asset.logo}
          alt={asset.name}
          width={size}
          height={size}
          decoding="async"
          onError={() => setImgFailed(true)}
          style={{ width: size, height: size, objectFit: "cover", display: "block" }}
        />
      </div>
    );
  }

  return (
    <div
      className="tile"
      style={{
        width: size,
        height: size,
        background: asset.color,
        borderRadius: br,
        fontSize: fs,
      }}
    >
      {asset.kind === "safe" ? "$" : letter.toUpperCase()}
    </div>
  );
}

export interface StaxWordmarkProps {
  /** Mark glyph size; the wordmark scales relative to it. */
  size?: number;
  color?: string;
}

// Tasteful Stax logotype — the real app-icon logo beside a serif-display "Stax".
// Theme-aware: green-tile logo on light, cream-tile logo on dark (toggled in CSS
// by .stax[data-mode]) so the mark always has contrast against the surface.
export function StaxWordmark({ size = 30 }: StaxWordmarkProps) {
  const dim = Math.round(size * 1.2);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 11 }}>
      <img
        src="/brand/stax-light.png"
        alt="Stax"
        width={dim}
        height={dim}
        style={{
          width: dim,
          height: dim,
          display: "block",
          borderRadius: Math.round(dim * 0.28),
          filter: "drop-shadow(0 4px 14px rgba(70, 84, 62, 0.18))",
        }}
      />
      <span
        className="serif"
        style={{ fontSize: size * 0.95, lineHeight: 1, letterSpacing: "-.01em", color: "var(--ink)" }}
      >
        Stax
      </span>
    </span>
  );
}

// ── Logo cluster ─────────────────────────────────────────────────────────────
// Up to `max` overlapping AssetTiles (2px --surface ring) with a "+N" disc for
// the rest. Used on basket tiles/rail, Activity rows, Vera's recorded plans.
//
//   <LogoCluster assets={[{ symbol: "NVDA" }, { symbol: "AAPL", name: "Apple" }]} size={24} />
export interface LogoClusterProps {
  assets: { symbol: string; name?: string }[];
  /** Tile size in px (default 24). */
  size?: number;
  /** Tiles shown before the "+N" disc (default 4). */
  max?: number;
  /** Ring colour between tiles (default var(--surface)). */
  ring?: string;
}

export function LogoCluster({ assets, size = 24, max = 4, ring = "var(--surface)" }: LogoClusterProps) {
  const shown = assets.length > max ? assets.slice(0, max) : assets;
  const rest = assets.length - shown.length;
  const radius = Math.round(size * 0.295);
  const overlap = Math.round(size * 0.22);
  const item = (i: number): React.CSSProperties => ({
    display: "block",
    flex: "none",
    borderRadius: radius,
    boxShadow: `0 0 0 2px ${ring}`,
    marginLeft: i === 0 ? 0 : -overlap,
    position: "relative",
    zIndex: i + 1,
  });
  return (
    <span
      aria-label={assets.map((a) => a.name ?? a.symbol).join(", ")}
      role="img"
      // isolate: the per-tile z-index must not escape into the page (it was
      // painting clusters over sticky bars).
      style={{ display: "inline-flex", alignItems: "center", flex: "none", padding: 2, isolation: "isolate" }}
    >
      {shown.map((a, i) => (
        <span key={a.symbol} style={item(i)}>
          <AssetTile asset={toTile(a.symbol, a.name)} size={size} radius={radius} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="tnum"
          style={{
            ...item(shown.length),
            width: size,
            height: size,
            borderRadius: "50%",
            background: "var(--surface-2)",
            color: "var(--ink-2)",
            display: "grid",
            placeItems: "center",
            fontSize: Math.max(9, Math.round(size * 0.42)),
            fontWeight: 700,
            letterSpacing: "-.02em",
          }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
