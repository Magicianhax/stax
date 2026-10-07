"use client";

// Placing — "securing your investment" progress, used for BOTH Vera invests and
// manual trades (screens_invest.jsx · Placing).
//
//   kind="invest": steps follow the REAL invest phase from useInvest
//     planning  -> "Confirming your plan"
//     approving -> "Buying each holding"
//     investing -> "Securing it to your account"
//   kind="trade":  useSwap only has one live phase ("swapping"), so the first
//     two steps advance on a short cosmetic timer and the last one completes
//     when the swap is done (phase "done").
//
// Each finished step draws its check (DrawCheck); the active label pulses once
// on arrival; the orb breathes until everything is done. LiteApp keeps this
// screen up for at least 1.2 s so it never flashes.
import { useEffect, useState } from "react";
import { VeraOrb, Seal } from "@/components/design";
import { DrawCheck } from "@/components/motion";
import { useChain } from "@/lib/chains/active";
import { Spinner } from "./primitives";

const INVEST_STEPS = ["Confirming your plan", "Buying each holding", "Securing it to your account"];

function investStep(phase: string): number {
  if (phase === "done") return 3;
  if (phase === "planning") return 0;
  if (phase === "approving") return 1;
  return 2; // investing
}

export function PlacingScreen({
  phase,
  kind = "invest",
  side = "buy",
}: {
  phase: string;
  kind?: "invest" | "trade";
  side?: "buy" | "sell";
}) {
  const chain = useChain();
  const steps =
    kind === "trade"
      ? [
          side === "sell" ? "Confirming your sell" : "Confirming your buy",
          `Trading on ${chain.name}`,
          side === "sell" ? "Adding it to your cash" : "Securing it to your account",
        ]
      : INVEST_STEPS;

  // Trade: cosmetic advance for the first two steps; the last waits for the swap.
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (kind !== "trade") return;
    const a = setTimeout(() => setTicks(1), 650);
    const b = setTimeout(() => setTicks(2), 1350);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [kind]);
  const i = kind === "trade" ? (phase === "done" ? 3 : ticks) : investStep(phase);
  const done = i >= steps.length;

  return (
    <div className="screen screen-pad-top" style={{ justifyContent: "center", padding: "0 24px" }}>
      {/* Centring fix: one auto-margin column, never wider than the screen. */}
      <div style={{ width: "100%", maxWidth: 320, margin: "0 auto", textAlign: "center" }}>
        <div
          style={{
            position: "relative",
            width: 110,
            height: 110,
            margin: "0 auto 26px",
            display: "grid",
            placeItems: "center",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              width: 132,
              height: 132,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--primary) 42%, transparent), transparent 68%)",
              filter: "blur(26px)",
              animation: done ? "none" : "breathe 3.6s ease-in-out infinite",
              opacity: done ? 0.55 : 1,
              transition: "opacity .4s var(--ease-out)",
            }}
          />
          <VeraOrb size={64} pulse={!done} />
        </div>

        <h1 className="serif" style={{ margin: "0 0 22px", fontSize: 26, lineHeight: 1.15 }}>
          {kind === "trade" ? (
            <>
              Placing your
              <br />
              {side === "sell" ? "sell" : "buy"}
            </>
          ) : (
            <>
              Securing your
              <br />
              investment
            </>
          )}
        </h1>

        <div className="card" style={{ width: "100%", padding: "4px 18px", textAlign: "left" }}>
          {steps.map((s, idx) => {
            const state = idx < i ? "done" : idx === i ? "active" : "todo";
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 0",
                  borderTop: idx ? "1px solid var(--line-2)" : "none",
                  opacity: state === "todo" ? 0.4 : 1,
                  transition: "opacity .3s var(--ease-out)",
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 99,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    background: state === "done" ? "transparent" : "var(--surface-2)",
                    color: "var(--ink-3)",
                  }}
                >
                  {state === "done" ? (
                    <DrawCheck size={24} />
                  ) : state === "active" ? (
                    <Spinner small />
                  ) : (
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor" }} />
                  )}
                </span>
                {/* key flips when the step becomes active so the label fades in once */}
                <span
                  key={state === "active" ? "on" : "off"}
                  style={{
                    fontSize: 15,
                    fontWeight: state === "active" ? 600 : 500,
                    animation: state === "active" ? "fade .6s var(--ease-out) both" : "none",
                  }}
                >
                  {s}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 26,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--ink-2)",
          }}
        >
          {/* "Signed & recorded" is only true on the executor path; BNB Chain trades go straight from the account. */}
          <Seal size={18} /> No network cost · {chain.contracts.deployed ? <>signed &amp; recorded on {chain.name}</> : "checked by Binance first"}
        </div>
      </div>
    </div>
  );
}
