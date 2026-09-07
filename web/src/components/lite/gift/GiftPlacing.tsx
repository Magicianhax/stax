"use client";

// Sending a gift — the Placing pattern, worded for a gift.
//
// PlacingScreen's `kind` only knows "invest" and "trade" (and it is shared with
// the trade flow), so this is the same anatomy locally: the breathing orb, a
// three-step card where each finished step draws its check, and the quiet
// "no network cost" line. Every step here tracks a real phase — giving is two
// sponsored transactions and a server confirmation, so nothing is on a timer.
import { VeraOrb, Seal } from "@/components/design";
import { DrawCheck } from "@/components/motion";
import { useChain } from "@/lib/chains/active";
import { Spinner } from "../screens/primitives";
import type { GiftPhase } from "@/hooks/useGifts";

// Giving is genuinely three things, and two of them are separate transactions,
// so each step here maps to a real phase rather than a timer.
const STEPS = ["Buying the basket", "Setting it aside for them", "Writing the record"];

const STEP_OF: Record<GiftPhase, number> = {
  idle: 0,
  reserving: 0,
  buying: 0,
  parking: 1,
  recording: 2,
  done: 3,
  error: 0,
};

export function GiftPlacing({ phase }: { phase: GiftPhase }) {
  const chain = useChain();
  const i = STEP_OF[phase];
  const done = i >= STEPS.length;

  return (
    <div className="screen screen-pad-top" style={{ justifyContent: "center", padding: "0 24px" }}>
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
          Sending your
          <br />
          gift
        </h1>

        {/* Two confirmations, both gasless — said before they wonder. */}
        <p style={{ margin: "-12px 0 20px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
          This takes two steps. Nothing to approve, and no network cost either time.
        </p>

        <div className="card" style={{ width: "100%", padding: "4px 18px", textAlign: "left" }}>
          {STEPS.map((s, idx) => {
            const state = idx < i ? "done" : idx === i ? "active" : "todo";
            return (
              <div
                key={s}
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
          <Seal size={18} /> No network cost · signed &amp; recorded on {chain.name}
        </div>
      </div>
    </div>
  );
}
