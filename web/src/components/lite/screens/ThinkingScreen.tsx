"use client";

// The "thinking" moment — a living Vera animation while the REAL allocation is
// being built (useInvest.allocate → POST /api/allocate). Faithful re-skin of the
// design (screens_lite.jsx · Thinking), but the copy steps are purely cosmetic:
// the router advances to the plan only when the real allocation resolves (or
// surfaces an error), not on a fixed timer.
import { useEffect, useState } from "react";
import { VeraOrb } from "@/components/design";
import { ThinkingDots } from "./primitives";

const STEPS = [
  "Reading your goal…",
  "Picking real companies & funds…",
  "Balancing growth and safety…",
  "Checking today's prices…",
  "Signing the plan…",
];

export function ThinkingScreen() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((p) => Math.min(p + 1, STEPS.length - 1)), 720);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="screen screen-pad-top"
      style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 32px" }}
    >
      <div style={{ position: "relative", marginBottom: 34, display: "grid", placeItems: "center" }}>
        {/* soft breathing glow instead of hard expanding rings */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            width: 150,
            height: 150,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--primary) 42%, transparent), transparent 68%)",
            filter: "blur(26px)",
            animation: "breathe 3.6s ease-in-out infinite",
          }}
        />
        <VeraOrb size={92} pulse />
      </div>
      <h1 className="serif" style={{ margin: "0 0 22px", fontSize: 28, letterSpacing: "-.01em" }}>
        Vera is building
        <br />
        your plan
      </h1>
      {/* Step copy swaps as ONE morph (blur-mask), not a fade-pop. Both the
          current and previous lines are stacked; only the active one is shown. */}
      <div style={{ position: "relative", display: "grid", minHeight: 26 }}>
        {STEPS.map((s, idx) => (
          <div
            key={idx}
            className="xfade-layer"
            data-show={idx === i ? "true" : "false"}
            style={{
              gridArea: "1 / 1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
              fontSize: 15.5,
              color: "var(--ink-2)",
              fontWeight: 500,
            }}
          >
            <ThinkingDots /> {s}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 26 }}>
        {STEPS.map((_, idx) => (
          <span
            key={idx}
            style={{
              width: idx <= i ? 22 : 8,
              height: 5,
              borderRadius: 99,
              background: idx <= i ? "var(--primary)" : "var(--line)",
              transition: "width .4s var(--ease-out), background .4s var(--ease-out)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
