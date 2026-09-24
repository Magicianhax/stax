"use client";

// VenuePicker — "Who you buy from": both issuers of a BSC tokenized stock side by side, with WHY
// one is picked (design critique P0 #4 — the old "Venues" title and bare "bStock" / "Ondo" names
// gave no reason for the choice). Selects `bestVenue` by default (buyable, then the smallest gap
// — lib/rwa.ts computes it) and tags that row "Best right now"; the buy flow itself (Task 12) is
// what wires a selection into a quote, so this only tracks which row is chosen and reports it
// upward.
//
// A row for a venue that isn't trading right now stays reachable by keyboard and screen reader
// (aria-disabled, not the native `disabled` attribute) so a viewer can still land on it and hear
// why it's off, per the project's accessibility guidance on disabled vs aria-disabled controls.
// Each row is its own tab stop with `aria-pressed`, not `role="radio"`: a real ARIA radiogroup
// demands roving-tabindex and arrow-key selection, which two plain, independently focusable
// buttons don't need to fake.
import { useState, type CSSProperties } from "react";
import type { RwaPlatform } from "@/lib/chains";
import type { VenueView } from "@/lib/rwa";
import { usd } from "@/lib/format";
import { gapWords, stateLabel, venuePickerExplainer } from "@/lib/plainCopy";
import { MarketStatusBadge } from "./MarketStatusBadge";

/** Display name for an issuer — shared with TradeScreen's "via bStock" / "via Ondo" line. */
export const PLATFORM_LABEL: Record<RwaPlatform, string> = { bstock: "bStock", ondo: "Ondo" };

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
  // Only an explicit tap is stored; until then (and whenever the tapped venue stops trading)
  // the ring follows `bestVenue`, which arrives after the catalog loads and moves with it.
  const [picked, setPicked] = useState<RwaPlatform | null>(null);
  const pickedLive = picked !== null && venues.some((v) => v.platform === picked && v.buyable);
  const shown = interactive && pickedLive ? picked : bestVenue;
  if (venues.length === 0) return null;
  // Design critique P0 #4 reviewer follow-up: only earns its place when there's a second row to
  // explain — AMZN has no twin, and a ticker whose twin `/tokens` doesn't list (AAPL/AAPLB)
  // renders one row too, and both used to show "Two companies make a token..." under a single row.
  const explainer = venuePickerExplainer(venues.length, bestVenue);

  return (
    <div style={style}>
      <div className="card" role="group" aria-label="Who you buy from" style={{ padding: "2px 14px" }}>
        {venues.map((v, i) => {
          const on = shown === v.platform;
          const off = !v.buyable;
          const best = bestVenue === v.platform;
          const words = gapWords(v.gapPct);
          const status = stateLabel({ state: v.state, buyable: v.buyable, nextOpenMs: v.nextOpenMs, platformLabel: PLATFORM_LABEL[v.platform] });
          return (
            <button
              key={v.platform}
              type="button"
              aria-pressed={on}
              aria-disabled={off}
              // Include the visible status and gap words, not just the price — a screen reader
              // must hear the same "why" a sighted viewer reads off the row (design critique #15).
              aria-label={`${PLATFORM_LABEL[v.platform]}${best ? ", best right now" : ""}, ${usd(v.tokenPrice)}${words ? `, ${words}` : ""}, ${status}`}
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
                  // Unselected ring: --line reads under 1.2:1 against the card's white surface,
                  // effectively invisible (design critique P1 #7) — --ink-3 is the quiet-but-legible
                  // token DESIGN.md reserves for metadata like this.
                  border: `2px solid ${on ? "var(--primary)" : "var(--ink-3)"}`,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)" }} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span translate="no" style={{ fontWeight: 600, fontSize: 14.5, color: "var(--ink)" }}>
                    {PLATFORM_LABEL[v.platform]}
                  </span>
                  {best && (
                    <span
                      className="chip"
                      style={{ height: 18, padding: "0 7px", fontSize: 10.5, fontWeight: 700, background: "var(--primary-soft)", color: "var(--primary)", boxShadow: "none" }}
                    >
                      Best right now
                    </span>
                  )}
                </div>
                <MarketStatusBadge state={v.state} nextOpenMs={v.nextOpenMs} buyable={v.buyable} platform={v.platform} nested style={{ marginTop: 4 }} />
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 14.5, color: "var(--ink)" }}>
                  {usd(v.tokenPrice)}
                </div>
                {words && (
                  // --ink-3 measured 2.31:1 on this surface (design critique P1 #7); --ink-2 is
                  // DESIGN.md's floor for anything a user must actually read, not just glance past.
                  <div className="tnum" style={{ fontSize: 12, fontWeight: 600, marginTop: 1, color: "var(--ink-2)" }}>
                    {words}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {explainer && (
        <p style={{ margin: "10px 2px 0", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
          {explainer}
        </p>
      )}
    </div>
  );
}
