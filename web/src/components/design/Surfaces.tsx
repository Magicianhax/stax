"use client";

// Stax surface + layout primitives — ported from the design handoff (components.jsx).
// BottomSheet, HoldingRow, Eyebrow, VerifiedBadge, Stat, SectionTitle.
// (Confetti now lives in the motion kit as Burst; re-exported below.)
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { AssetTile, type TileAsset } from "./Brand";
import { Sparkline } from "./Charts";
import { useDragDismiss } from "../../hooks/useDragDismiss";
import { useFlashRow } from "../motion/useFlashRow";

// ── Bottom sheet ────────────────────────────────────────────────────────────
// A modal dialog (role="dialog", aria-modal) that springs up from the bottom edge
// (`sheetUp` keyframe: --ease-drawer 0.42 s with a 1.5 % overshoot) and exits in
// 0.22 s. Focus moves to the panel on open and returns to the opener on close;
// Escape closes; drag-to-dismiss via useDragDismiss.
export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Renders the title row and labels the dialog. */
  title?: string;
  /** Accessible name when there is no `title` (e.g. a custom header inside). */
  label?: string;
  children?: ReactNode;
}

export function BottomSheet({ open, onClose, title, label, children }: BottomSheetProps) {
  // Keep the sheet mounted briefly after `open` flips false so the scrim can
  // fade out (exit faster than enter). `mounted` drives presence; `shown`
  // drives the open/closed visual state via data-open.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const titleId = useId();
  const opener = useRef<HTMLElement | null>(null);

  // Drag-to-dismiss wired to the same close path; the drag animates the panel
  // off-screen itself, then calls onClose via onDismiss.
  const { ref, handlers } = useDragDismiss<HTMLDivElement>({ onDismiss: onClose });

  // Presence follows `open` synchronously (derived state); the visual state and
  // the unmount are scheduled so enter/exit can animate.
  if (open && !mounted) setMounted(true);
  if (!open && shown) setShown(false);

  useEffect(() => {
    if (open) {
      opener.current = (document.activeElement as HTMLElement | null) ?? null;
      // next frame → animate in (avoids appearing-from-nothing on first paint).
      const r = requestAnimationFrame(() => {
        setShown(true);
        ref.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(r);
    }
    const t = setTimeout(() => setMounted(false), 220);
    const prev = opener.current;
    opener.current = null;
    if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    return () => clearTimeout(t);
  }, [open, ref]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      onClick={onClose}
      data-open={shown ? "true" : "false"}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 80,
        background: "rgba(10,10,8,.4)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-end",
        opacity: shown ? 1 : 0,
        transition: "opacity .2s var(--ease-out)",
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? label : undefined}
        tabIndex={-1}
        className="sheet-panel"
        data-open={shown ? "true" : "false"}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          background: "var(--glass)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
          borderRadius: "var(--r-xl) var(--r-xl) 0 0",
          boxShadow: "var(--glass-shadow), var(--glass-hi)",
          maxHeight: "88%",
          overflowY: "auto",
          outline: "none",
          padding: "6px 20px calc(20px + env(safe-area-inset-bottom))",
          // Enter is the `sheetUp` spring (CSS animation, fill backwards so the
          // drag can write transform directly once it ends); exit is a 0.22 s
          // transition to the edge.
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: "transform .22s var(--ease-drawer)",
          touchAction: "none",
        }}
      >
        {/* Real grab handle — wider hit area, the visible pill is the affordance. */}
        <div
          {...handlers}
          role="button"
          aria-label="Drag to dismiss"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "10px 0 12px",
            margin: "0 -20px",
            cursor: "grab",
            touchAction: "none",
          }}
        >
          <div
            style={{
              width: 40,
              height: 5,
              borderRadius: 99,
              background: "var(--line)",
            }}
          />
        </div>
        {title && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <h3 id={titleId} className="title-sm" style={{ margin: 0 }}>
              {title}
            </h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="tap"
              style={{
                width: 44, // ≥44px touch target; the negative margin keeps the header line tight
                height: 44,
                margin: "-5px -6px -5px 0",
                borderRadius: 99,
                background: "var(--surface-2)",
                display: "grid",
                placeItems: "center",
                color: "var(--ink-2)",
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ── Blur-mask crossfade ───────────────────────────────────────────────────────
// Swaps between two states as ONE transform (blur + opacity + sub-pixel scale),
// so the eye reads a single morphing object rather than two overlapping layers.
// Used for Vera thinking → plan and morphing buttons. Interruptible (transitions,
// not keyframes). Layers are stacked absolutely; the wrapper sizes to whichever is
// shown so layout doesn't jump.
export interface CrossfadeProps {
  /** Which layer is active. */
  showFirst: boolean;
  first: ReactNode;
  second: ReactNode;
  /** Wrapper style (e.g. width for a morphing button). */
  style?: CSSProperties;
  className?: string;
}

export function Crossfade({ showFirst, first, second, style, className }: CrossfadeProps) {
  return (
    <div
      className={className}
      style={{ position: "relative", display: "grid", ...style }}
    >
      <div className="xfade-layer" data-show={showFirst ? "true" : "false"} style={{ gridArea: "1 / 1" }}>
        {first}
      </div>
      <div className="xfade-layer" data-show={showFirst ? "false" : "true"} style={{ gridArea: "1 / 1" }}>
        {second}
      </div>
    </div>
  );
}

// ── Holding / asset row ───────────────────────────────────────────────────────
// One anatomy everywhere: AssetTile 44 · name · sub ("{qty} {symbol}" by default)
// · right column = value + change (pos/neg coloured), or a custom `right` slot.
//
//   <HoldingRow asset={tile} qty="0.4303" symbol="NVDA" value="$99.75"
//               change={{ pct: 2.41, label: "today" }} onClick={…} flashKey={…} />
export interface HoldingChange {
  /** Percent change, e.g. 2.41 → "+2.41%". */
  pct?: number;
  /** Absolute USD change, e.g. -12.4 → "-$12.40". Shown before pct when both given. */
  abs?: number;
  /** Suffix, e.g. "today", "1M". Alone (no pct/abs) it renders muted. */
  label?: string;
}

export interface HoldingRowProps {
  asset: TileAsset & { day?: number; spark?: number[] };
  /** Ticker used by the default sub-label ("{qty} {symbol}"). */
  symbol?: string;
  /** Quantity used by the default sub-label. */
  qty?: string | number;
  /** Secondary line under the name; overrides the qty/symbol default. */
  sub?: ReactNode;
  /** Right-aligned value (e.g. "$642.18"). Ignored when `right` is provided. */
  value?: ReactNode;
  /** Change line under the value, coloured pos/neg. */
  change?: HoldingChange;
  /** Fully custom right-hand content. */
  right?: ReactNode;
  onClick?: () => void;
  dim?: boolean;
  showSpark?: boolean;
  /** One-time --primary-soft wash when the row enters view (see useFlashRow). */
  flashKey?: string;
  size?: number;
}

function fmtChange(c: HoldingChange): { text: string; up: boolean | null } {
  const parts: string[] = [];
  const n = c.abs ?? c.pct;
  if (c.abs !== undefined) {
    const a = Math.abs(c.abs).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    parts.push(`${c.abs < 0 ? "-" : "+"}$${a}`);
  }
  if (c.pct !== undefined) parts.push(`${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(2)}%`);
  if (c.label) parts.push(c.label);
  return { text: parts.join(" "), up: n === undefined ? null : n >= 0 };
}

export function HoldingRow({
  asset,
  symbol,
  qty,
  sub,
  value,
  change,
  right,
  onClick,
  dim,
  showSpark = true,
  flashKey,
  size = 44,
}: HoldingRowProps) {
  const day = asset.day ?? 0;
  const up = day >= 0;
  const { ref: flashRef, className: flashClass } = useFlashRow<HTMLButtonElement>(flashKey);
  const subLine = sub !== undefined ? sub : qty !== undefined && symbol ? `${qty} ${symbol}` : undefined;
  const ch = change ? fmtChange(change) : null;
  return (
    <button
      ref={flashRef}
      onClick={onClick}
      className={`${onClick ? "tap" : ""} ${flashClass}`.trim() || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        width: "100%",
        padding: "12px 4px",
        borderRadius: 12,
        textAlign: "left",
        background: "none",
        opacity: dim ? 0.5 : 1,
      }}
    >
      <AssetTile asset={asset} size={size} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 16.5,
            letterSpacing: "-.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {asset.name}
        </div>
        {subLine !== undefined && (
          <div
            className="tnum"
            style={{
              fontSize: 13.5,
              color: "var(--ink-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subLine}
          </div>
        )}
      </div>
      {showSpark && asset.spark && asset.kind !== "safe" && (
        <Sparkline data={asset.spark} color={up ? "var(--pos)" : "var(--neg)"} />
      )}
      <div style={{ textAlign: "right", minWidth: 64, flex: "none" }}>
        {right !== undefined ? (
          right
        ) : (
          <>
            <div className="tnum" style={{ fontWeight: 600, fontSize: 16 }}>
              {value}
            </div>
            {ch && ch.text && (
              <div
                className="tnum"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  marginTop: 2,
                  color: ch.up === null ? "var(--ink-3)" : ch.up ? "var(--pos)" : "var(--neg)",
                }}
              >
                {ch.text}
              </div>
            )}
          </>
        )}
      </div>
    </button>
  );
}

// ── Eyebrow / small caps label ───────────────────────────────────────────────
export interface EyebrowProps {
  children: ReactNode;
  style?: CSSProperties;
}

export function Eyebrow({ children, style }: EyebrowProps) {
  return (
    <div className="label-eyebrow" style={style}>
      {children}
    </div>
  );
}

// ── On-chain trust badge (plain words) ───────────────────────────────────────
export interface VerifiedBadgeProps {
  label?: string;
  onClick?: () => void;
}

// Stax verification seal — the sage gradient check we use as the "verified /
// signed" mark everywhere (Vera's identity, trust badges, receipts). One shared
// element keeps the trust language consistent across the app.
export function Seal({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--hero-grad)",
        display: "grid",
        placeItems: "center",
        flex: "none",
        boxShadow: `0 2px ${Math.round(size / 3)}px color-mix(in srgb, var(--primary) 36%, transparent)`,
      }}
    >
      <Icon name="check" size={Math.round(size * 0.56)} stroke={3} style={{ color: "var(--primary-ink)" }} />
    </span>
  );
}

export function VerifiedBadge({ label = "Recorded & verifiable", onClick }: VerifiedBadgeProps) {
  return (
    <button
      onClick={onClick}
      className="tap"
      style={{ display: "inline-flex", alignItems: "center", gap: 9, color: "var(--ink)" }}
    >
      <Seal size={21} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {onClick && <Icon name="chevR" size={15} style={{ color: "var(--ink-3)", marginLeft: -2 }} />}
    </button>
  );
}

// ── Small inline stat ────────────────────────────────────────────────────────
export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  accent?: string;
}

export function Stat({ label, value, accent }: StatProps) {
  return (
    <div style={{ flex: 1 }}>
      <div className="label-eyebrow" style={{ marginBottom: 5 }}>
        {label}
      </div>
      <div
        className="tnum"
        style={{
          fontSize: 19,
          fontWeight: 700,
          color: accent || "var(--ink)",
          letterSpacing: "-.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
export interface SectionTitleProps {
  children: ReactNode;
  action?: ReactNode;
  onAction?: () => void;
}

export function SectionTitle({ children, action, onAction }: SectionTitleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        margin: "0 0 10px",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.02em" }}>
        {children}
      </h2>
      {action && (
        <button onClick={onAction} style={{ fontSize: 14, fontWeight: 600, color: "var(--primary)" }}>
          {action}
        </button>
      )}
    </div>
  );
}

// ── Confetti burst ────────────────────────────────────────────────────────────
// Moved to the motion kit as `Burst` (brand palette, 900 ms, `fire` prop).
// Kept under the old name so existing callers keep working.
export { Burst as Confetti, type BurstProps as ConfettiProps } from "../motion/Burst";

export type { IconName };
