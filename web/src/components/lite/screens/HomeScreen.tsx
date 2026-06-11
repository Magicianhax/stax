"use client";

// Home — faithful re-skin of the design (screens_lite.jsx · Home) wired to REAL
// data: spendable cash from useUsdcBalance, invested holdings + approximate USD
// value from usePortfolio. Balance-privacy eye toggle masks every figure.
//
// Note on P&L: we don't track cost basis on-chain, so we DON'T fabricate an
// "all time" gain. The hero shows real total value; per-holding rows show the
// approximate current value. (The design's demo gain pill is intentionally
// omitted rather than faked.)
import { useState } from "react";
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { useActivity } from "@/hooks/useActivity";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import {
  Icon,
  VeraOrb,
  CountUp,
  HoldingRow,
  SectionTitle,
  VerifiedBadge,
} from "@/components/design";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd, tokenQty } from "@/lib/format";
import { iconBtn } from "./primitives";

const DOTS = "••••••";

export function HomeScreen({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  // Cash, invested, and total all arrive pre-computed from /api/portfolio —
  // this screen renders them verbatim (no client-side money math).
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);
  const { data: activity } = useActivity(address ?? undefined);
  const [hideBalance, setHideBalance] = useState(false);

  const balance = port?.cashUsd ?? 0;
  const holdings: Holding[] = port?.holdings ?? [];
  const invested = port?.investedUsd ?? 0;
  const total = port?.totalUsd ?? 0;

  // First-load skeleton (only the initial fetch; interval refetches keep the value).
  const balanceLoading = portLoading;
  // Overflow guard: shrink the hero numeral as the formatted value gets longer,
  // so a 7-figure balance never spills past the 402px frame.
  const balLen = usd(total).length;
  const balSize = balLen <= 9 ? 56 : balLen <= 11 ? 46 : 38;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 22px 4px",
        }}
      >
        <div>
          <div className="caption" style={{ fontWeight: 500 }}>Welcome back</div>
          <h1 className="serif" style={{ margin: 0, fontSize: 26, letterSpacing: "-.01em" }}>Your money</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => go("activity")} style={iconBtn} className="tap" aria-label="Activity">
            <Icon name="bell" size={21} />
          </button>
          <button onClick={() => go("settings")} style={iconBtn} className="tap" aria-label="Settings">
            <Icon name="settings" size={21} />
          </button>
        </div>
      </div>

      {/* balance hero — the focal point. An ambient sage glow gives the number
          real presence (depth as a brand material, not decoration). */}
      <div className="anim-rise" style={{ padding: "18px 22px 6px", position: "relative" }}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 10,
            width: 300,
            height: 170,
            background:
              "radial-gradient(58% 58% at 26% 46%, color-mix(in srgb, var(--primary) 24%, transparent), transparent 72%)",
            filter: "blur(6px)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="label-eyebrow">Total balance</div>
            <button
              onClick={() => setHideBalance((v) => !v)}
              className="tap"
              aria-label={hideBalance ? "Show balance" : "Hide balance"}
              style={{
                width: 44, // ≥44px hit target; negative margins keep the label row tight
                height: 44,
                margin: "-9px -4px",
                borderRadius: 99,
                display: "grid",
                placeItems: "center",
                color: hideBalance ? "var(--primary)" : "var(--ink-3)",
                transition: "color .2s var(--ease-out)",
              }}
            >
              <Icon name="eye" size={16} stroke={hideBalance ? 2.4 : 1.8} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginTop: 8, minHeight: 54 }}>
            {balanceLoading ? (
              <div
                className="skeleton"
                style={{ width: 190, height: 46, borderRadius: 14, marginTop: 4 }}
              />
            ) : (
              <div
                className="tnum"
                style={{ fontSize: balSize, fontWeight: 700, letterSpacing: "-.045em", lineHeight: 0.96 }}
              >
                {hideBalance ? (
                  <span style={{ letterSpacing: ".06em" }}>{DOTS}</span>
                ) : (
                  <CountUp to={total} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* balance split row */}
      <div style={{ display: "flex", gap: 10, padding: "14px 22px 4px" }}>
        <div className="card" style={{ flex: 1, padding: "14px 16px" }}>
          <div className="label-eyebrow">Invested</div>
          <div className="tnum" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
            {hideBalance ? DOTS : usd(invested)}
          </div>
        </div>
        <button
          className="card tap"
          onClick={() => go("wallet")}
          style={{
            flex: 1,
            padding: "14px 16px",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div className="label-eyebrow">Cash to invest</div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              {hideBalance ? DOTS : usd(balance)}
            </div>
          </div>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 99,
              background: "var(--primary)",
              color: "var(--primary-ink)",
              display: "grid",
              placeItems: "center",
              flex: "none",
            }}
          >
            <Icon name="plus" size={18} stroke={2.4} />
          </span>
        </button>
      </div>

      {/* Vera invite */}
      <div className="anim-rise" style={{ animationDelay: ".06s", padding: "16px 22px 4px" }}>
        <button
          onClick={() => go("goal")}
          className="card tap"
          style={{
            width: "100%",
            textAlign: "left",
            padding: 18,
            display: "flex",
            gap: 14,
            alignItems: "center",
            background: "var(--hero-grad)",
            color: "var(--primary-ink)",
            boxShadow: "var(--shadow-lg)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* ambient sheen — sits behind, never blocks the press */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(120% 140% at 92% -20%, rgba(255,255,255,.28), transparent 55%)",
              pointerEvents: "none",
            }}
          />
          {/* signature light-sweep — one pass on mount, the brand's hero moment */}
          <span aria-hidden className="sheen-sweep" />
          <VeraOrb size={50} pulse />
          <div style={{ flex: 1, position: "relative" }}>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em" }}>
              Invest with Vera
            </div>
            <div style={{ fontSize: 13.5, opacity: 0.85, marginTop: 1 }}>
              Tell me a goal, and I&apos;ll build the plan.
            </div>
          </div>
          <Icon name="arrowUR" size={22} stroke={2.2} style={{ position: "relative" }} />
        </button>
      </div>

      {/* holdings */}
      <div style={{ padding: "20px 22px 0" }}>
        <SectionTitle>What you own</SectionTitle>
        {holdings.length === 0 ? (
          <div
            className="card"
            style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
              Nothing here yet
            </div>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>
              Tell Vera a goal and place your first plan in one tap.
            </div>
          </div>
        ) : (
          <div className="card stagger-in" style={{ padding: "4px 14px" }}>
            {holdings.slice(0, 5).map((h, i) => {
              const base = toTile(h.asset.symbol, h.asset.name);
              // Real 1D market data (from the server) replaces the presentational
              // tint whenever the asset has a live source.
              const tile = {
                ...base,
                day: h.dayChangePct ?? base.day,
                spark: h.spark ?? base.spark,
              };
              const day = h.dayChangePct;
              // Plain holdings line ("1.13 sUSDe") — no visible math; the price
              // and value live on the asset page.
              const qtyLine = `${tokenQty(h.raw, h.asset.decimals ?? 18)} ${h.asset.symbol}`;
              return (
                <div
                  key={h.asset.symbol}
                  style={{
                    borderBottom:
                      i < Math.min(holdings.length, 5) - 1 ? "1px solid var(--line-2)" : "none",
                  }}
                >
                  <HoldingRow
                    asset={tile}
                    sub={hideBalance ? catFor(h.asset.symbol, h.asset.name) : qtyLine}
                    showSpark
                    onClick={() => go("asset", { symbol: h.asset.symbol })}
                    right={
                      <div className="tnum" style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>
                          {hideBalance
                            ? DOTS
                            : h.valueUsd !== undefined
                              ? usd(h.valueUsd)
                              : tokenQty(h.raw, h.asset.decimals ?? 18)}
                        </div>
                        {day !== undefined && (
                          <div
                            style={{
                              fontSize: 12.5,
                              fontWeight: 600,
                              marginTop: 2,
                              color: day >= 0 ? "var(--pos)" : "var(--neg)",
                            }}
                          >
                            {(day >= 0 ? "+" : "") + day.toFixed(2)}% today
                          </div>
                        )}
                      </div>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* recent activity — REAL, from the on-chain executor log */}
      {activity && activity.length > 0 && (
        <div style={{ padding: "20px 22px 0" }}>
          <SectionTitle>Recent activity</SectionTitle>
          <div className="card" style={{ padding: "4px 14px" }}>
            {activity.slice(0, 5).map((a, i) => (
              <button
                key={a.txHash + i}
                className="row"
                onClick={() =>
                  go("receipt", {
                    title: "Invested in a plan",
                    amount: a.usdc,
                    txHash: a.txHash,
                  })
                }
                style={{
                  padding: "13px 0",
                  borderBottom:
                    i < Math.min(activity.length, 5) - 1 ? "1px solid var(--line-2)" : "none",
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 11,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    background: "var(--primary-soft)",
                    color: "var(--primary)",
                  }}
                >
                  <Icon name="check" size={17} stroke={2.2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>Invested in a plan</div>
                  <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                    {a.legCount} {a.legCount === 1 ? "holding" : "holdings"}
                  </div>
                </div>
                <span className="tnum" style={{ fontWeight: 700, fontSize: 15 }}>
                  {hideBalance ? DOTS : usd(a.usdc)}
                </span>
              </button>
            ))}
          </div>
          {activity.length > 5 && (
            <button
              className="tap"
              onClick={() => go("activity")}
              style={{ width: "100%", marginTop: 10, padding: "11px", borderRadius: 12, background: "var(--surface-2)", fontSize: 13.5, fontWeight: 600, color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
            >
              View all activity <Icon name="chevR" size={15} />
            </button>
          )}
        </div>
      )}

      {/* trust footer */}
      <div style={{ padding: "18px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("vera")} />
      </div>
    </div>
  );
}
