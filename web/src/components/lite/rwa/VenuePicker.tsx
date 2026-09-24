"use client";

// VenuePicker — both issuers of a BSC tokenized stock side by side: price, gap vs
// the real share, and whether each is trading right now. Selects `bestVenue` by
// default (buyable, then the smallest gap — lib/rwa.ts computes it); the buy flow
// itself (Task 12) is what wires a selection into a quote, so this only tracks
// which row is chosen and reports it upward.
//
// A row for a venue that isn't trading right now stays reachable by keyboard and
// screen reader (aria-disabled, not the native `disabled` attribute) so a viewer
// can still land on it and hear why it's off, per the project's accessibility
// guidance on disabled vs aria-disabled controls. Each row is its own tab stop
// with `aria-pressed`, not `role="radio"`: a real ARIA radiogroup demands
// roving-tabindex and arrow-key selection, which two plain, independently
// focusable buttons don't need to fake.
import { useState, type CSSProperties } from "react";
import type { RwaPlatform } from "@/lib/chains";
import type { VenueView } from "@/lib/rwa";
import { usd } from "@/lib/format";
import { MarketStatusBadge } from "./MarketStatusBadge";

const PLATFORM_LABEL: Record<RwaPlatform, string> = { bstock: "bStock", ondo: "Ondo" };

export interface VenuePickerProps {
  venues: VenueView[];
  bestVenue: RwaPlatform | null;
  /** Fires when the viewer picks a tradeable venue; the caller decides what that means. */
  onSelect?: (platform: RwaPlatform) => void;
  style?: CSSProperties;
}

export function VenuePicker({ venues, bestVenue, onSelect, style }: VenuePickerProps) {
  // Without `onSelect` a click has nowhere to go: the buy flow (Task 12) is what turns a picked
  // row into a different quote, and until that's wired, letting the ring move on a tap would
  // show a choice the buy ignores — the ring stays locked to whatever the caller says is the
  // buy target (`bestVenue`) instead of tracking clicks.
  const interactive = Boolean(onSelect);
  const [picked, setPicked] = useState<RwaPlatform | null>(bestVenue);
  const shown = interactive ? picked : bestVenue;
  if (venues.length === 0) return null;

  return (
    <div className="card" role="group" aria-label="Venue" style={{ padding: "2px 14px", ...style }}>
      {venues.map((v, i) => {
        const on = shown === v.platform;
        const off = !v.buyable;
        return (
          <button
            key={v.platform}
            type="button"
            aria-pressed={on}
            aria-disabled={off}
            aria-label={`${PLATFORM_LABEL[v.platform]}, ${usd(v.tokenPrice)}${off ? ", not tradeable right now" : ""}`}
            onClick={() => {
              if (off || !interactive) return;
              setPicked(v.platform);
              onSelect?.(v.platform);
            }}
            className="row tap"
            style={{
              width: "100%",
              textAlign: "left",
              padding: "12px 0",
              background: "none",
              border: 0,
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderTop: i ? "1px solid var(--line-2)" : "none",
              // Full opacity even when off: the badge text and the unfilled ring already
              // say "not tradeable" — washing out the price and label too just costs
              // contrast for no extra information (the app dims disabled *buttons* this
              // way, but this row's label stays worth reading).
              cursor: off || !interactive ? "default" : "pointer",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                flex: "none",
                border: `2px solid ${on ? "var(--primary)" : "var(--line)"}`,
                display: "grid",
                placeItems: "center",
              }}
            >
              {on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)" }} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: "var(--ink)" }}>{PLATFORM_LABEL[v.platform]}</div>
              <MarketStatusBadge state={v.state} nextOpenMs={v.nextOpenMs} style={{ marginTop: 4 }} />
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              <div className="tnum" style={{ fontWeight: 600, fontSize: 14.5, color: "var(--ink)" }}>
                {usd(v.tokenPrice)}
              </div>
              {v.gapPct !== null && (
                // Neutral, not pos/neg: a premium over the reference isn't a gain or a loss,
                // so it doesn't earn the app's gain/loss color (matches PriceGap below).
                <div className="tnum" style={{ fontSize: 12, fontWeight: 600, marginTop: 1, color: "var(--ink-3)" }}>
                  {v.gapPct >= 0 ? "+" : ""}
                  {v.gapPct.toFixed(2)}%
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
