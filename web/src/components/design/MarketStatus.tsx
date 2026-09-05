"use client";

// MarketStatus — a quiet pill (dot + words) saying whether the US stock market
// is open, and when that changes. Tokenized stocks trade on-chain around the
// clock, but their reference price only moves while the NYSE is open, so the
// pill is the honest "prices can drift" signal on Market, Asset detail and
// Trade. Tapping it opens a plain-words explainer sheet.
//
//   <MarketStatus />              "Open · closes 4:00pm ET" / "Closed · opens Mon 9:30am ET"
//   <MarketStatus detail />       when closed, the longer line: "Market closed · trades still
//                                 go through, prices can drift until Mon 9:30am ET"
//
// Hydration-safe: the status is computed after mount (the server can't know the
// viewer's clock), and re-checked every 30s so the pill flips on its own at the
// open/close.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  closedReasonText,
  describeNextChange,
  formatEtTime,
  marketStatus,
  type MarketStatus as Status,
} from "@/lib/marketHours";
import { haptic } from "@/lib/haptics";
import { BottomSheet } from "./Surfaces";

const TICK_MS = 30_000;

/** Live NYSE session status; null until mounted (avoids a server/client mismatch). */
export function useMarketStatus(): Status | null {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const tick = () => setStatus(marketStatus(new Date()));
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);
  return status;
}

export interface MarketStatusProps {
  /** Longer "prices can drift" line when the market is closed (Asset detail, Trade). */
  detail?: boolean;
  style?: CSSProperties;
}

export function MarketStatus({ detail = false, style }: MarketStatusProps) {
  const status = useMarketStatus();
  const [open, setOpen] = useState(false);

  // Reserve the row before mount so the header doesn't jump when the pill lands.
  if (!status) return <span aria-hidden style={{ display: "inline-block", height: 44, ...style }} />;

  const when = describeNextChange(status);
  const untilOpen = when.replace(/^opens /, "");
  const wraps = detail && !status.open;
  const text =
    detail && !status.open
      ? `Market closed · trades still go through, prices can drift until ${untilOpen}`
      : `${detail ? (status.open ? "Market open" : "Market closed") : status.open ? "Open" : "Closed"} · ${when}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic.light();
          setOpen(true);
        }}
        className="tap"
        aria-label={`US stock market ${status.open ? "open" : "closed"}, ${when}. Tap for what this means`}
        style={{
          // 44px tall hit area around a 28px visual pill; the negative vertical
          // margin keeps the row's rhythm where the pill sits inline.
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          margin: "-8px 0",
          padding: 0,
          background: "none",
          textAlign: "left",
          maxWidth: "100%",
          ...style,
        }}
      >
        <span
          className="chip"
          style={{
            height: "auto",
            minHeight: 28,
            padding: wraps ? "5px 12px 5px 10px" : "0 12px 0 10px",
            gap: 7,
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--ink-2)",
            whiteSpace: wraps ? "normal" : "nowrap",
            lineHeight: 1.35,
            alignItems: wraps ? "flex-start" : "center",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              flex: "none",
              marginTop: wraps ? 5 : 0,
              background: status.open ? "var(--pos)" : "var(--ink-3)",
              boxShadow: status.open ? "0 0 0 3px color-mix(in srgb, var(--pos) 22%, transparent)" : "none",
            }}
          />
          <span>{text}</span>
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
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                flex: "none",
                background: status.open ? "var(--pos)" : "var(--ink-3)",
              }}
            />
            <div style={{ fontSize: 14.5, lineHeight: 1.45 }}>
              <b style={{ color: "var(--ink)" }}>
                The US stock market is {status.open ? "open" : "closed"}.
              </b>{" "}
              <span style={{ color: "var(--ink-2)" }}>
                {status.open ? "" : `${closedReasonText(status)} `}It {when}.
              </span>
            </div>
          </div>
          <Para>
            You can buy and sell here any time, day or night. The pools that hold these stocks never close.
          </Para>
          <Para>
            The reference price is the last official stock-market price. It only updates while the market is
            open: 9:30am to 4:00pm ET, Monday to Friday, except US holidays
            {status.open && status.nextChange && formatEtTime(status.nextChange) !== "4:00pm"
              ? ` (today it closes early, at ${formatEtTime(status.nextChange)})`
              : ""}
            .
          </Para>
          <Para>
            While it&apos;s closed, you might pay a little more or less than that last official price. Your order
            still goes through right away.
          </Para>
          <button
            type="button"
            className="btn btn-ghost btn-block tap"
            onClick={() => setOpen(false)}
            style={{ marginTop: 4 }}
          >
            Got it
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

function Para({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-2)" }}>{children}</p>
  );
}
