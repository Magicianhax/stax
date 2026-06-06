"use client";

// Goal input — faithful re-skin of the design (screens_lite.jsx · GoalInput).
// Conversational goal + amount + suggestion chips. On "Build my plan" it hands
// { goal, amt } up to the router, which calls useInvest.allocate (POST /api/allocate).
import { useState } from "react";
import { useUsdcBalance } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { Icon, VeraOrb } from "@/components/design";
import { usd } from "@/lib/format";
import { iconBtn, VeraTag } from "./primitives";

const SUGGESTIONS = [
  "Grow $300, mostly big tech, keep a little safe",
  "Play it safe and still earn a bit",
  "A little of everything to start",
  "Go big on AI companies",
];

export function GoalScreen({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const balance = bal?.value ?? 0;

  const [goal, setGoal] = useState("");
  const [amt, setAmt] = useState("300");

  const amount = parseFloat(amt);
  const ready = goal.trim().length > 3 && amount > 0;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go("home")} style={iconBtn} className="tap" aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <div style={{ marginLeft: 4 }}>
          <VeraTag verified />
        </div>
      </div>

      <div className="anim-rise" style={{ padding: "26px 22px 0", flex: 1 }}>
        <h1 className="display" style={{ margin: 0 }}>
          What are you
          <br />
          hoping to do?
        </h1>
        <p className="body" style={{ marginTop: 12, maxWidth: 300 }}>
          Say it however feels natural. No finance words needed; I&apos;ll handle the rest.
        </p>

        {/* amount */}
        <div style={{ marginTop: 28 }}>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            How much to invest
          </div>
          <div
            className="field"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 16px",
            }}
          >
            <span className="tnum" style={{ fontSize: 30, fontWeight: 700, color: "var(--ink-3)" }}>
              $
            </span>
            <input
              value={amt}
              onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              aria-label="Amount to invest"
              className="tnum"
              style={{
                flex: 1,
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: "-.02em",
                width: "100%",
              }}
            />
            <span className="caption" style={{ fontWeight: 500 }}>of {usd(balance)}</span>
          </div>
        </div>

        {/* goal text */}
        <div style={{ marginTop: 18 }}>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            Your goal
          </div>
          <div className="field" style={{ padding: "14px 16px" }}>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              aria-label="Your goal"
              placeholder="e.g. Grow this over a few years, mostly big names, but keep some safe…"
              style={{
                width: "100%",
                fontSize: 16,
                lineHeight: 1.45,
                display: "block",
              }}
            />
          </div>
        </div>

        {/* suggestions */}
        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className={`chip tap ${goal === s ? "is-on" : ""}`}
              onClick={() => setGoal(s)}
              style={{ height: "auto", padding: "9px 13px", whiteSpace: "normal", textAlign: "left", lineHeight: 1.3 }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>
        <button
          className="btn btn-primary btn-block btn-lg tap"
          disabled={!ready}
          onClick={() => go("thinking", { goal: goal.trim(), amt: amount })}
        >
          <VeraOrb size={26} /> Build my plan
        </button>
      </div>
    </div>
  );
}
