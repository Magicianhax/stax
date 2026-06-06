"use client";

// Placing — "securing your investment" progress. Faithful re-skin of the design
// (screens_invest.jsx · Placing) wired to the REAL invest phase from useInvest:
//   planning  -> "Confirming your plan"     (server signs the plan)
//   approving -> "Buying each holding"
//   investing -> "Securing it to your account" (batched, sponsored UserOp)
// The ring + active step are derived from the real phase, not a fixed timer.
import { Icon, VeraOrb } from "@/components/design";
import { Spinner } from "./primitives";

const STEPS = ["Confirming your plan", "Buying each holding", "Securing it to your account"];

// Map invest phase → active step index (0..2).
function stepFor(phase: string): number {
  if (phase === "planning") return 0;
  if (phase === "approving") return 1;
  return 2; // investing
}

export function PlacingScreen({ phase }: { phase: string }) {
  const i = stepFor(phase);

  return (
    <div
      className="screen screen-pad-top"
      style={{ alignItems: "center", justifyContent: "center", padding: "0 36px", textAlign: "center" }}
    >
      {/* Soft breathing glow (no progress ring) — the step list below shows progress. */}
      <div style={{ position: "relative", width: 110, height: 110, marginBottom: 30, display: "grid", placeItems: "center" }}>
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
            animation: "breathe 3.6s ease-in-out infinite",
          }}
        />
        <VeraOrb size={64} pulse />
      </div>

      <h1 className="serif" style={{ margin: "0 0 24px", fontSize: 26 }}>
        Securing your
        <br />
        investment
      </h1>

      <div
        className="card"
        style={{ width: "100%", maxWidth: 300, padding: "4px 18px", textAlign: "left" }}
      >
        {STEPS.map((s, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 0",
              borderTop: idx ? "1px solid var(--line-2)" : "none",
              opacity: idx <= i ? 1 : 0.4,
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
                background: idx < i ? "var(--primary)" : "var(--surface-2)",
                color: idx < i ? "var(--primary-ink)" : "var(--ink-3)",
                transition: "background .3s var(--ease-out), color .3s var(--ease-out)",
              }}
            >
              {idx < i ? (
                <Icon name="check" size={15} stroke={2.6} />
              ) : idx === i ? (
                <Spinner small />
              ) : (
                <span style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor" }} />
              )}
            </span>
            <span style={{ fontSize: 15, fontWeight: 500, textAlign: "left" }}>{s}</span>
          </div>
        ))}
      </div>

      <div className="verified" style={{ marginTop: 28 }}>
        <Icon name="shield" size={13} stroke={2} /> Gas-free · signed &amp; verified on-chain
      </div>
    </div>
  );
}
