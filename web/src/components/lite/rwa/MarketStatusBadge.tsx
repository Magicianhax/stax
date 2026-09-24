"use client";

// MarketStatusBadge — the plain-words state for one BSC venue or ticker: "Open now",
// "Closed · opens Mon 6:30 PM your time", "Paused by Ondo for now", "Can't be bought here".
// `lib/plainCopy.ts`'s `stateLabel` is the one source of that wording (design critique P1 #8 —
// the old copy leaked trader terms like "Pre-market" and "Overnight" straight to the screen),
// and `formatOpensLocal` inside it is the one place any next-open instant becomes a clock face,
// so this never disagrees with the Trade screen's closed line or the server's refusal about what
// time it is. A real 44px `<button>` (not just a chip) so it can open the explainer sheet below,
// same idiom as `MarketStatus`'s NYSE pill on Base/Mantle.
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
  style?: CSSProperties;
}

export function MarketStatusBadge({ state, nextOpenMs, buyable, platform, style }: MarketStatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const live = buyable ?? state === "open";
  const platformLabel = platform ? PLATFORM_LABEL[platform] : undefined;
  const text = stateLabel({ state, buyable: live, nextOpenMs, platformLabel });

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
        <span
          className="chip"
          style={{
            height: 22,
            padding: "0 9px",
            gap: 6,
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--ink-2)",
            boxShadow: "none",
            background: "var(--surface-2)",
            whiteSpace: "nowrap",
            ...style,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              flex: "none",
              background: live ? "var(--pos)" : "var(--ink-3)",
              boxShadow: live ? "0 0 0 3px color-mix(in srgb, var(--pos) 22%, transparent)" : "none",
            }}
          />
          {text}
        </span>
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
              <b style={{ color: "var(--ink)" }}>{platformLabel ?? "This issuer"}</b> is {text.toLowerCase()}.
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
