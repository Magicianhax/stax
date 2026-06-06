"use client";

// Plan review — the key trust moment. Faithful re-skin of the design
// (screens_invest.jsx · PlanReview) wired to the REAL allocation returned by
// useInvest.allocate (AllocateResult: summary, rationale, riskScore bps,
// allocations[{symbol, weightPct, reason}]).
//
//   - Vera's note  -> allocation.summary + rationale
//   - allocation bar + named holdings + each one's "why" (reason)
//   - RiskMeter     -> derived from riskScore (bps → 1..5)
//   - Nudge chips   -> re-run allocate() with an adjusted goal/riskTolerance and
//                      visibly rebuild the plan (the "rethinking" state)
//   - big button    -> onInvest() (useInvest.invest → /api/invest-plan + send)
import { Icon, VeraOrb, AssetTile, RiskMeter, VerifiedBadge, Crossfade } from "@/components/design";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd } from "@/lib/format";
import { STAX_FEE_LABEL, feeUsd } from "@/lib/fees";
import type { AllocateResult } from "@/lib/invest-types";
import { iconBtn, Spinner, ThinkingDots } from "./primitives";

type Tone = "balanced" | "safer" | "bolder" | "simple";

const NUDGES: { id: Tone; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "safer", label: "Make it safer" },
  { id: "bolder", label: "Be bolder" },
  { id: "simple", label: "Keep it simple" },
];

// Map a 0..10000 bps risk score to the 1..5 meter + a friendly label.
function riskMeta(bps: number): { level: number; label: string } {
  const v = Math.max(0, Math.min(100, bps / 100));
  if (v < 20) return { level: 1, label: "Very steady" };
  if (v < 40) return { level: 2, label: "Cautious" };
  if (v < 60) return { level: 3, label: "Balanced" };
  if (v < 80) return { level: 4, label: "Adventurous" };
  return { level: 5, label: "Bold" };
}

export function PlanScreen({
  go,
  allocation,
  amount,
  tone,
  rethinking,
  busy,
  onNudge,
  onInvest,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
  allocation: AllocateResult;
  amount: number;
  tone: Tone;
  rethinking: boolean;
  busy: boolean;
  onNudge: (tone: Tone) => void;
  onInvest: () => void;
}) {
  const risk = riskMeta(allocation.riskScore);

  // While Vera recomposes (a nudge), blur + soften the basket so it reads as one
  // morphing object — transform/filter only, interruptible, GPU-friendly.
  const recompose: React.CSSProperties = {
    filter: rethinking ? "blur(5px)" : "blur(0)",
    opacity: rethinking ? 0.55 : 1,
    transform: rethinking ? "scale(0.99)" : "none",
    transition:
      "filter .34s var(--ease-out), opacity .34s var(--ease-out), transform .34s var(--ease-out)",
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go("home")} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 4 }}>
          <VeraOrb size={26} />
          <h1 className="serif" style={{ margin: 0, fontSize: 21, letterSpacing: "-.01em" }}>Vera&apos;s plan</h1>
        </div>
      </div>

      {/* Vera's note — the message blur-morphs between "rethinking" and the plan,
          so a nudge reads as Vera re-composing one thought (not two states). */}
      <div className="anim-rise" style={{ padding: "16px 22px 0" }}>
        <div style={{ display: "flex", gap: 12 }}>
          <VeraOrb size={34} pulse />
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "4px var(--rr) var(--rr) var(--rr)",
              padding: "13px 15px",
              boxShadow: "var(--shadow)",
              fontSize: 15,
              lineHeight: 1.5,
              minHeight: 20,
              flex: 1,
            }}
          >
            <Crossfade
              showFirst={rethinking}
              first={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 9, color: "var(--ink-2)" }}>
                  <ThinkingDots /> Rethinking your plan…
                </span>
              }
              second={
                <span style={{ display: "block", color: "var(--ink-2)" }}>
                  Here&apos;s what I&apos;d do with{" "}
                  <b className="tnum" style={{ color: "var(--ink)" }}>
                    {usd(amount)}
                  </b>
                  .
                  <b
                    style={{
                      display: "block",
                      color: "var(--ink)",
                      fontWeight: 700,
                      fontSize: 16,
                      letterSpacing: "-.01em",
                      marginTop: 8,
                    }}
                  >
                    {allocation.summary}
                  </b>
                  <span style={{ display: "block", marginTop: 5 }}>{allocation.rationale}</span>
                </span>
              }
            />
          </div>
        </div>
      </div>

      {/* nudge chips — talk back to Vera */}
      <div style={{ display: "flex", gap: 8, padding: "14px 22px 0", overflowX: "auto", flexShrink: 0 }}>
        {NUDGES.map((n) => (
          <button
            key={n.id}
            onClick={() => onNudge(n.id)}
            disabled={rethinking || busy}
            className={`chip tap ${tone === n.id ? "is-on" : ""}`}
            style={{ flex: "none", opacity: rethinking && tone !== n.id ? 0.6 : 1 }}
          >
            {n.label}
          </button>
        ))}
      </div>

      {/* allocation bar — blurs softly while Vera recomposes (one morph, not a grey-out) */}
      <div
        className="anim-rise"
        style={{ ...recompose, animationDelay: ".04s", padding: "16px 22px 0" }}
      >
        <div style={{ display: "flex", height: 14, borderRadius: 99, overflow: "hidden", gap: 2 }}>
          {allocation.allocations.map((a) => {
            const tile = toTile(a.symbol);
            return (
              <div
                key={a.symbol}
                style={{ width: `${a.weightPct}%`, background: tile.color, transition: "width .45s var(--ease-out)" }}
                title={tile.name}
              />
            );
          })}
        </div>
      </div>

      {/* holdings */}
      <div
        style={{ ...recompose, padding: "16px 22px 0" }}
        className="stagger"
      >
        {allocation.allocations.map((a) => {
          const tile = toTile(a.symbol);
          const dollars = (amount * a.weightPct) / 100;
          return (
            <div key={a.symbol} className="card" style={{ padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <AssetTile asset={tile} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: 16.5 }}>{tile.name}</span>
                    <span className="tnum" style={{ fontWeight: 700, fontSize: 16 }}>
                      {usd(dollars)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 1 }}>
                    <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{catFor(a.symbol)}</span>
                    <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600 }}>
                      {Math.round(a.weightPct)}%
                    </span>
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 13.5,
                  color: "var(--ink-2)",
                  marginTop: 10,
                  lineHeight: 1.45,
                  display: "flex",
                  gap: 7,
                }}
              >
                <Icon name="info" size={15} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
                {a.reason}
              </div>
            </div>
          );
        })}
      </div>

      {/* risk */}
      <div style={{ ...recompose, padding: "6px 22px 0" }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)" }}>
              How bumpy this could feel
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }}>{risk.label}</span>
          </div>
          <RiskMeter level={risk.level} />
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "10px 0 0", lineHeight: 1.5 }}>
            Some ups and downs are normal. Stocks can go down too, so only invest what you can leave
            for a while.
          </p>
        </div>
      </div>

      {/* trust line */}
      <div style={{ padding: "14px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Vera will sign & record this plan" onClick={() => go("vera")} />
      </div>

      {/* Pinned invest bar — sticky (NOT absolute, which scrolls inside an
          overflow container). margin-top:auto holds it at the bottom on short
          content; sticky bottom:0 keeps it fixed while the plan scrolls behind. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "16px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)",
        }}
      >
        <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-2)", marginBottom: 10 }}>
          {STAX_FEE_LABEL} fee ({usd(feeUsd(amount))}) · gas on us
        </div>
        <button className="btn btn-primary btn-block btn-lg tap" disabled={rethinking || busy} onClick={onInvest}>
          <Crossfade
            showFirst={busy && !rethinking}
            style={{ alignItems: "center" }}
            first={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                <Spinner small /> Securing…
              </span>
            }
            second={<span>Invest {usd(amount)}</span>}
          />
        </button>
      </div>
    </div>
  );
}
