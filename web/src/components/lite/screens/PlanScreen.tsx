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
import { useState } from "react";
import { Icon, VeraOrb, AssetTile, RiskMeter, VerifiedBadge, Crossfade, ChainLaunchingLine, BottomSheet, useToast } from "@/components/design";
import { HoldButton } from "@/components/motion";
import { useBaskets } from "@/hooks/useBaskets";
import { allocationToBasket, shortName, BASKET_NAME_MAX, type Basket } from "@/lib/baskets";
import { haptic } from "@/lib/haptics";
import { shareBasket, WeightBar } from "./basketPrimitives";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd } from "@/lib/format";
import { assetBySymbol } from "@/lib/chains";
import { STAX_FEE_LABEL, feeUsd } from "@/lib/fees";
import { planDryRunView } from "@/lib/planDryRuns";
import type { DryRun } from "@/lib/dryRun";
import type { AllocateResult } from "@/lib/invest-types";
import { iconBtn, Spinner, ThinkingDots, YieldTag } from "./primitives";
import { useChainReady } from "../useChainReady";

type Tone = "balanced" | "safer" | "bolder" | "simple";

const NUDGES: { id: Tone; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "safer", label: "Make it safer" },
  { id: "bolder", label: "Be bolder" },
  { id: "simple", label: "Keep it simple" },
];

// Map a 0..10000 bps risk score to the 1..5 meter + a friendly label.
export function riskMeta(bps: number): { level: number; label: string } {
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
  basket,
  goal,
  dryRuns,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
  allocation: AllocateResult;
  amount: number;
  tone: Tone;
  rethinking: boolean;
  busy: boolean;
  onNudge: (tone: Tone) => void;
  onInvest: () => void;
  /** Set when this plan came from a basket: fixed weights, so no nudge chips. */
  basket?: Basket;
  /** The goal that produced this plan (kept on a saved basket as its origin). */
  goal?: string;
  /**
   * One Binance Transaction API dry run per leg, same order as `allocation.allocations`
   * (InvestPlanResult.dryRuns — wave-5 "dryrun" stream). Not wired end to end yet: useInvest.ts
   * only learns these inside `invest()`, right as the hold-to-confirm fires, and doesn't expose
   * them on its returned object for a screen to read beforehand — see wiringNeeded in the wave
   * report for the smallest edit that would. Undefined here renders exactly what this screen
   * already did.
   */
  dryRuns?: DryRun[];
}) {
  const risk = riskMeta(allocation.riskScore);
  const { chain, investable } = useChainReady();
  const dryRunView = planDryRunView(allocation.allocations, dryRuns, (s) => assetBySymbol(chain, s)?.decimals ?? 18);
  const { save } = useBaskets();
  const { notify } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState(shortName(allocation.summary));
  // Curated baskets are already listed and personal ones already saved, so only a
  // fresh Vera plan (or a shared basket) has something worth saving.
  const canSave = !basket || basket.author === "shared";

  const asBasket = () => basket ?? allocationToBasket(chain, allocation, name, goal, { author: "vera" });
  const onSave = () => {
    save({ ...asBasket(), name: name.trim() || shortName(allocation.summary), author: "you" });
    setSaveOpen(false);
    haptic.light();
    notify("Saved to your baskets", "check");
  };
  const onShare = async () => {
    haptic.light();
    const r = await shareBasket(asBasket());
    if (r === "copied") notify("Link copied", "link");
    else if (r === "failed") notify("Couldn't copy the link. Try again.", "info");
  };

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

      {/* nudge chips — talk back to Vera (a basket's weights are fixed, so none) */}
      {!basket && (
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
      )}

      {/* allocation bar — blurs softly while Vera recomposes (one morph, not a grey-out) */}
      <div
        className="anim-rise"
        style={{ ...recompose, animationDelay: ".04s", padding: "16px 22px 0" }}
      >
        <WeightBar items={allocation.allocations} height={14} animate />
      </div>

      {/* holdings */}
      <div
        style={{ ...recompose, padding: "16px 22px 0" }}
        className="stagger"
      >
        {allocation.allocations.map((a) => {
          const tile = toTile(a.symbol);
          const dollars = (amount * a.weightPct) / 100;
          const check = dryRunView.legs.find((l) => l.symbol === a.symbol);
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
                    {assetBySymbol(chain, a.symbol)?.tier === "safe" ? (
                      <YieldTag symbol={a.symbol} />
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{catFor(a.symbol)}</span>
                    )}
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
              {/* Binance's own pre-trade check on this leg, in plain words — never claims a
                  check that didn't run (design decision in lib/plainCopy.ts's dryRunLine, matched
                  here for the "not checked yet" case that screen deliberately stays silent on). */}
              {check && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: check.status === "failed" ? "var(--neg)" : "var(--ink-3)",
                    fontWeight: check.status === "failed" ? 600 : 500,
                    marginTop: 6,
                    lineHeight: 1.4,
                  }}
                >
                  {check.text}
                </div>
              )}
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
        <VerifiedBadge label="Vera will sign & record this plan" onClick={() => go("settings")} />
      </div>

      {/* quiet text actions — keep this mix, or hand it to a friend */}
      <div style={{ ...recompose, padding: "10px 22px 0", display: "flex", justifyContent: "center", gap: 4 }}>
        {canSave && (
          <button
            className="tap"
            disabled={rethinking}
            onClick={() => setSaveOpen(true)}
            style={{ minHeight: 44, padding: "0 12px", fontSize: 13.5, fontWeight: 600, color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="plus" size={15} /> Save as basket
          </button>
        )}
        <button
          className="tap"
          disabled={rethinking}
          onClick={onShare}
          style={{ minHeight: 44, padding: "0 12px", fontSize: 13.5, fontWeight: 600, color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Icon name="link" size={15} /> Share this plan
        </button>
      </div>

      <BottomSheet open={saveOpen} onClose={() => setSaveOpen(false)} title="Name this basket">
        <div className="field" style={{ padding: "13px 16px" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, BASKET_NAME_MAX))}
            maxLength={BASKET_NAME_MAX}
            aria-label="Basket name"
            placeholder="e.g. My steady mix"
            autoFocus
            style={{ width: "100%", fontSize: 17, fontWeight: 600 }}
          />
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "10px 0 0", lineHeight: 1.5 }}>
          Saved baskets keep these exact weights. Invest in them again anytime from Baskets.
        </p>
        <button className="btn btn-primary btn-block btn-lg tap" style={{ marginTop: 14 }} onClick={onSave}>
          Save basket
        </button>
      </BottomSheet>

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
        {investable ? (
          <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-2)", marginBottom: 10 }}>
            {/* Design critique P2 #14: "gas" is jargon a first-time investor shouldn't need —
                matches the wording TradeScreen already uses for the same fact. */}
            {chain.key === "bsc" ? "No fee" : `${STAX_FEE_LABEL} fee (${usd(feeUsd(amount, chain.key))})`} · no network cost
          </div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <ChainLaunchingLine chain={chain} />
          </div>
        )}
        {/* Same hold-to-confirm as manual trades: a plan (or basket) invest moves
            real money, so a tap never fires it. The busy state is a plain, quiet
            button while the transaction is secured. */}
        {busy && !rethinking ? (
          <button className="btn btn-primary btn-block btn-lg" disabled aria-live="polite">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
              <Spinner small /> Securing…
            </span>
          </button>
        ) : (
          <HoldButton onComplete={onInvest} disabled={rethinking || busy || !investable || dryRunView.blocked} className="btn-lg">
            {`Hold to invest ${usd(amount)}`}
          </HoldButton>
        )}
      </div>
    </div>
  );
}
