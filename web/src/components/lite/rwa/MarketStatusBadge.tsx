"use client";

// MarketStatusBadge — the plain-words state for one BSC venue or ticker: "Open now",
// "Closed · opens Mon 6:30 PM your time", "Paused by Ondo for now", "Can't be bought here".
// `lib/plainCopy.ts`'s `stateLabel` is the one source of that wording (design critique P1 #8 —
// the old copy leaked trader terms like "Pre-market" and "Overnight" straight to the screen),
// and `formatOpensLocal` inside it is the one place any next-open instant becomes a clock face,
// so this never disagrees with the Trade screen's closed line or the server's refusal about what
// time it is.
//
// A real 44px `<button>` opening the explainer sheet below, same idiom as `MarketStatus`'s NYSE
// pill on Base/Mantle — but ONLY when it's the row's own tap target. VenuePicker's and Market's
// rows are themselves a `<button>` (picking the venue / opening the asset), and a `<button>`
// nested inside a `<button>` is invalid HTML: the browser silently drops the outer handler on
// some inputs, screen readers can't tell the two apart, and a tap meant for the badge also
// "picks" the row underneath it. `nested` (set by those two callers) renders the plain chip with
// no wrapper and no sheet; the sheet stays reachable from AssetDetail's standalone badge, which
// isn't inside another button.
import { useState, type CSSProperties } from "react";
import type { RwaPlatform } from "@/lib/chains";
import type { MarketState } from "@/lib/rwa";
import { stateLabel } from "@/lib/plainCopy";
import { BottomSheet } from "@/components/design";
import { haptic } from "@/lib/haptics";

const PLATFORM_LABEL: Record<RwaPlatform, string> = { bstock: "bStock", ondo: "Ondo" };

export interface MarketStatusBadgeProps {
  state: MarketState;
  /** Epoch ms of the next regular-session open; the "opens <time>" clause when present. */
  nextOpenMs: number | null;
  /** Whether the issuer will fill a buy right now. Ondo trades pre-market, after hours and
   * overnight, so the session name alone can't say "live"; defaults to `state === "open"`. */
  buyable?: boolean;
  /** Names the issuer on a pause ("Paused by Ondo for now") instead of an anonymous "the market". */
  platform?: RwaPlatform;
  /** True inside a row that is already a `<button>` (VenuePicker, Market's list row): renders the
   *  plain chip, no tap target of its own and no sheet, so two interactive controls never nest. */
  nested?: boolean;
  /** Overrides `stateLabel`'s wording — Market's header says a whole-market line instead. */
  label?: string;
  style?: CSSProperties;
}

function Chip({ text, live, style }: { text: string; live: boolean; style?: CSSProperties }) {
  return (
    <span
      className="chip"
      style={{
        // minHeight (not a fixed height) + normal wrapping + flex-start: the plain-words states
        // ("Paused by Ondo for now", "Closed · opens Mon 6:30 PM your time") run longer than the
        // old one-word "Paused"/"Closed", and a nowrap pill just overflowed its column and
        // overlapped whatever sat beside it (caught in the wave-5 UX preview screenshot) — this
        // wraps onto a second line inside whatever width the caller gives it instead.
        // `.stax .chip` sets a fixed 38px height for tappable chips; a status chip is a label,
        // so it sizes to its text (design critique P0 #4 — it rendered as a 38px grey pill).
        height: "auto",
        minHeight: 22,
        padding: "3px 9px",
        gap: 6,
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1.3,
        color: "var(--ink-2)",
        boxShadow: "none",
        background: "var(--surface-2)",
        whiteSpace: "normal",
        alignItems: "flex-start",
        maxWidth: "100%",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          marginTop: 4,
          borderRadius: "50%",
          flex: "none",
          background: live ? "var(--pos)" : "var(--ink-3)",
          boxShadow: live ? "0 0 0 3px color-mix(in srgb, var(--pos) 22%, transparent)" : "none",
        }}
      />
      {text}
    </span>
  );
}

export function MarketStatusBadge({ state, nextOpenMs, buyable, platform, nested, label, style }: MarketStatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const live = buyable ?? state === "open";
  const platformLabel = platform ? PLATFORM_LABEL[platform] : undefined;
  const text = label ?? stateLabel({ state, buyable: live, nextOpenMs, platformLabel });

  if (nested) return <Chip text={text} live={live} style={style} />;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic.light();
          setOpen(true);
        }}
        className="tap"
        aria-label={`${platformLabel ? `${platformLabel}: ` : ""}${text}. Tap for what this means`}
        style={{
          // 44px hit area around the visual chip, same trick MarketStatus uses for its pill.
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          margin: "-11px 0",
          padding: 0,
          background: "none",
          border: 0,
          textAlign: "left",
          maxWidth: "100%",
        }}
      >
        <Chip text={text} live={live} style={style} />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Market hours">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "2px 2px 6px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 16,
              background: "var(--surface-2)",
            }}
          >
            <span
              aria-hidden
              style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: live ? "var(--pos)" : "var(--ink-3)" }}
            />
            <div style={{ fontSize: 14.5, lineHeight: 1.45, color: "var(--ink-2)" }}>
              {/* Reviewer follow-up on design critique P1 #8: `stateLabel`'s paused/unsupported
                  words are already full clauses ("Paused by Ondo for now", "Can't be bought
                  here"), not adjectives — wrapping them in "<Platform> is <text>" read as "Ondo is
                  paused by ondo for now" (redundant AND lowercased) or "Ondo is can't be bought
                  here" (not a sentence). Only the session-clock states (open/closed/etc.) still
                  fit that "is <state>" shape. */}
              {state === "paused" || state === "unsupported" ? (
                <>
                  <b style={{ color: "var(--ink)" }}>{platformLabel ?? "This issuer"}</b>{" "}
                  {state === "paused" ? "has paused this stock for now." : "can't trade this share."}
                </>
              ) : (
                <>
                  <b style={{ color: "var(--ink)" }}>{platformLabel ?? "This issuer"}</b> is {text.toLowerCase()}.
                </>
              )}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
            {live
              ? "You can buy and sell this share right now."
              : state === "paused"
                ? `${platformLabel ?? "The issuer"} has paused this stock. It isn't anything you did — check back shortly, or pick the other issuer if one is trading.`
                : state === "unsupported"
                  ? "This share isn't one Binance can trade. Nothing you do here will change that."
                  : "The real stock market is closed, so this token can't be bought or sold right now either. It reopens with the market."}
          </p>
          <button type="button" className="btn btn-ghost btn-block tap" onClick={() => setOpen(false)} style={{ marginTop: 4 }}>
            Got it
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
