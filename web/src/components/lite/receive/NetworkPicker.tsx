"use client";

// Step 1 of "From any network": a grid of network tiles in the curated order.
// Marks + names only; no chain ids on screen.
import { NetworkMark, hasBrandMark } from "@/lib/chainMarks";
import { haptic } from "@/lib/haptics";
import type { ReceiveNetwork } from "@/hooks/useReceive";
import s from "./receive.module.css";

export function NetworkPicker({
  networks,
  loading,
  error,
  onRetry,
  onPick,
}: {
  networks: ReceiveNetwork[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPick: (n: ReceiveNetwork) => void;
}) {
  if (error && !networks) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "6px 2px 8px" }}>
        <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{error}</p>
        <button type="button" className="btn btn-ghost tap" onClick={onRetry} style={{ height: 48, fontSize: 15 }}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "2px 0 6px" }}>
      <p style={{ margin: "0 2px", fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        Which network is the money on right now?
      </p>
      {loading || !networks ? (
        <div className={s.grid} aria-busy>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ minHeight: 92, borderRadius: 18 }} />
          ))}
        </div>
      ) : (
        <div className={s.grid} role="list">
          {networks.map((n) => (
            <button
              key={n.key}
              type="button"
              role="listitem"
              className={s.tile}
              onClick={() => { haptic.select(); onPick(n); }}
            >
              <span className={s.markDisc} style={hasBrandMark(n.key, n.id) ? { background: "transparent", boxShadow: "none" } : undefined}>
                <NetworkMark networkKey={n.key} chainId={n.id} name={n.name} size={hasBrandMark(n.key, n.id) ? 40 : 24} />
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.01em", textAlign: "center", lineHeight: 1.2 }}>{n.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
