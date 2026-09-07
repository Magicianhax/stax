"use client";

// Home — the glance screen: total balance with today's change and a sparkline
// (tap → Owned), spendable cash, the Vera invite, a rail of baskets, the top
// holdings and the latest activity. Wired to REAL data: cash + holdings from
// usePortfolio, activity from the on-chain executor log.
//
// After a trade or invest, LiteApp hands us `loop` ({ flash, txHash, prevCash,
// prevTotal }): the balance counts old → new and the touched rows flash once.
//
// Note on P&L: we don't track cost basis on-chain, so the only gain shown is
// today's move (real 1D market data per holding), never an invented "all time".
import { useState } from "react";
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { useActivity } from "@/hooks/useActivity";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useDemo } from "@/components/demo/DemoProvider";
import {
  Icon,
  VeraOrb,
  HoldingRow,
  LogoCluster,
  SectionTitle,
  Sparkline,
  VerifiedBadge,
  NetworkChip,
} from "@/components/design";
import { Money, Reveal } from "@/components/motion";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd, tokenQty } from "@/lib/format";
import { portfolioSeries } from "@/lib/demoSeries";
import { iconBtn } from "./primitives";
import { useChainReady } from "../useChainReady";
import { useBaskets } from "@/hooks/useBaskets";
import { BasketRailTile } from "./basketPrimitives";
import type { LoopParams } from "../LiteApp";

const DOTS = "••••••";
const TOP_HOLDINGS = 4;
const RECENT = 3;

function dayLabel(unixSec?: number): string | undefined {
  if (!unixSec) return undefined;
  return new Date(unixSec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Today's move across the priced holdings (absolute + percent of the opening value). */
function todayChange(holdings: Holding[], total: number): { abs: number; pct: number } | null {
  let abs = 0;
  let known = false;
  for (const h of holdings) {
    if (h.valueUsd === undefined || h.dayChangePct === undefined) continue;
    known = true;
    abs += h.valueUsd - h.valueUsd / (1 + h.dayChangePct / 100);
  }
  if (!known) return null;
  const open = total - abs;
  return { abs, pct: open > 0 ? (abs / open) * 100 : 0 };
}

/** Today's portfolio line: the holdings' real 1D sparklines blended by value, plus flat cash. */
function todaySpark(holdings: Holding[], cash: number): number[] {
  const parts = holdings.filter((h) => h.valueUsd !== undefined && h.spark && h.spark.length > 1);
  if (!parts.length) return [];
  const n = Math.min(...parts.map((h) => h.spark!.length));
  const out = new Array<number>(n).fill(cash);
  for (const h of parts) {
    const s = h.spark!;
    const last = s[s.length - 1];
    if (!(last > 0)) continue;
    for (let k = 0; k < n; k++) out[k] += (h.valueUsd! * s[s.length - n + k]) / last;
  }
  return out;
}

export function HomeScreen({
  go,
  loop,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
  loop?: LoopParams;
}) {
  const { address } = useSmartAccount();
  const { chain, ready } = useChainReady();
  const demo = useDemo();
  // Cash, invested, and total all arrive pre-computed from /api/portfolio —
  // this screen renders them verbatim (no client-side money math).
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);
  const { data: activity } = useActivity(address ?? undefined);
  const [hideBalance, setHideBalance] = useState(false);
  // Baskets rail: yours first, then Stax's — four tiles, the rest behind "See all".
  const { all: baskets } = useBaskets();
  const rail = baskets.slice(0, 4);

  const balance = port?.cashUsd ?? 0;
  const holdings: Holding[] = port?.holdings ?? [];
  const invested = port?.investedUsd ?? 0;
  const total = port?.totalUsd ?? 0;

  const today = todayChange(holdings, total);
  const up = (today?.abs ?? 0) >= 0;
  // Demo: the deterministic portfolio series (stable screenshots). Real: the
  // holdings' 1D sparklines, blended by value.
  const spark = demo ? portfolioSeries("1D", total).map((p) => p.v) : todaySpark(holdings, balance);

  // First-load skeleton (only the initial fetch; interval refetches keep the value).
  const balanceLoading = portLoading;
  // Overflow guard: shrink the hero numeral as the formatted value gets longer,
  // so a 7-figure balance never spills past the 402px frame.
  const balLen = usd(total).length;
  const balSize = balLen <= 9 ? 56 : balLen <= 11 ? 46 : 38;

  // Top holdings by value, plus the safe-tier cushion even when it is small: a
  // person who just bought Safe Dollars should see them without "See all".
  const top = holdings.slice(0, TOP_HOLDINGS);
  const shown = [...top, ...holdings.slice(TOP_HOLDINGS).filter((h) => h.asset.tier === "safe")];
  const recent = (activity ?? []).slice(0, RECENT);

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
          {/* quiet network chip — the only place the chain shows on Home */}
          <NetworkChip chain={chain} onClick={() => go("settings")} />
          <button onClick={() => go("activity")} style={iconBtn} className="tap" aria-label="Activity">
            <Icon name="clock" size={21} />
          </button>
          <button onClick={() => go("settings")} style={iconBtn} className="tap" aria-label="Settings">
            <Icon name="settings" size={21} />
          </button>
        </div>
      </div>

      <Reveal once="home">
        {/* balance hero — the focal point. An ambient sage glow gives the number
            real presence (depth as a brand material, not decoration). */}
        <div style={{ padding: "18px 22px 0", position: "relative" }}>
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
            {/* balance + today's change + sparkline: one tap target → Owned */}
            <button
              onClick={() => go("portfolio")}
              className="tap"
              aria-label="See how your money is doing"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", padding: 0, marginTop: 8 }}
            >
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14, minHeight: 54 }}>
                {balanceLoading ? (
                  <div className="skeleton" style={{ width: 190, height: 46, borderRadius: 14, marginTop: 4 }} />
                ) : hideBalance ? (
                  <div className="tnum" style={{ fontSize: balSize, fontWeight: 700, letterSpacing: ".06em", lineHeight: 0.96 }}>
                    {DOTS}
                  </div>
                ) : (
                  <Money
                    value={total}
                    prev={loop?.prevTotal}
                    size={balSize}
                    style={{ fontWeight: 700, letterSpacing: "-.045em", lineHeight: 0.96 }}
                  />
                )}
              </div>
              {today && !balanceLoading && (
                <span
                  className="chip tnum"
                  style={{
                    marginTop: 10,
                    height: 26,
                    padding: "0 10px",
                    gap: 5,
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: `color-mix(in srgb, ${up ? "var(--pos)" : "var(--neg)"} 13%, var(--surface))`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${up ? "var(--pos)" : "var(--neg)"} 28%, transparent)`,
                    color: up ? "var(--pos)" : "var(--neg)",
                  }}
                >
                  {hideBalance
                    ? DOTS
                    : `${up ? "+" : "-"}${usd(Math.abs(today.abs))} · ${up ? "+" : ""}${today.pct.toFixed(2)}%`}
                  <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>today</span>
                </span>
              )}
              {spark.length > 1 && (
                <div style={{ marginTop: 10, opacity: hideBalance ? 0.35 : 1, transition: "opacity .2s var(--ease-out)" }}>
                  <Sparkline data={spark} w={346} h={60} fill stretch color={up ? "var(--pos)" : "var(--neg)"} />
                </div>
              )}
            </button>
          </div>
        </div>

        {/* balance split row */}
        <div style={{ display: "flex", gap: 10, padding: "14px 22px 4px" }}>
          <button className="card tap" onClick={() => go("portfolio")} style={{ flex: 1, padding: "14px 16px", textAlign: "left" }}>
            <div className="label-eyebrow">Invested</div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              {hideBalance ? DOTS : usd(invested)}
            </div>
          </button>
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
                {hideBalance ? DOTS : <Money value={balance} prev={loop?.prevCash} />}
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
        <div style={{ padding: "16px 22px 4px" }}>
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
              background: "var(--vera-grad)",
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
                {ready
                  ? "Tell me a goal, and I’ll build the plan."
                  : `Opening shortly on ${chain.name}. Browse prices meanwhile.`}
              </div>
            </div>
            <Icon name="arrowUR" size={22} stroke={2.2} style={{ position: "relative" }} />
          </button>
        </div>

        {/* baskets rail — one-tap mixes, under the Vera card */}
        {rail.length > 0 && (
          <div style={{ padding: "22px 0 0" }}>
            <div style={{ padding: "0 22px" }}>
              <SectionTitle action="See all" onAction={() => go("baskets")}>
                Baskets
              </SectionTitle>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "2px 22px 6px",
                overflowX: "auto",
                // let the card shadows breathe past the scroll edge
                margin: "-2px 0 -6px",
              }}
            >
              {rail.map((b) => (
                <BasketRailTile key={b.id} basket={b} onClick={() => go("basket", { id: b.id })} />
              ))}
              <span aria-hidden style={{ flex: "none", width: 12 }} />
            </div>
          </div>
        )}

        {/* holdings — the top few; the full list with performance lives on Owned */}
        <div style={{ padding: "20px 22px 0" }}>
          <SectionTitle
            action={holdings.length > 0 ? "See all" : undefined}
            onAction={holdings.length > 0 ? () => go("portfolio") : undefined}
          >
            What you own
          </SectionTitle>
          {holdings.length === 0 ? (
            <div
              className="card"
              style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
                Nothing here yet
              </div>
              <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
                {ready
                  ? "Tell Vera a goal and place your first plan in one tap."
                  : `Nothing on ${chain.name} yet. Earlier investments live under Mantle in Settings.`}
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: "4px 14px" }}>
              {shown.map((h, i) => {
                const base = toTile(h.asset.symbol, h.asset.name);
                // Real 1D market data (from the server) replaces the presentational
                // tint whenever the asset has a live source.
                const tile = {
                  ...base,
                  day: h.dayChangePct ?? base.day,
                  spark: h.spark ?? base.spark,
                };
                const day = h.dayChangePct;
                const qty = tokenQty(h.raw, h.asset.decimals ?? 18);
                const flashed = loop?.flash.includes(h.asset.symbol);
                return (
                  <div
                    key={h.asset.symbol}
                    style={{ borderBottom: i < shown.length - 1 ? "1px solid var(--line-2)" : "none" }}
                  >
                    <HoldingRow
                      asset={tile}
                      qty={qty}
                      symbol={h.asset.symbol}
                      sub={hideBalance ? catFor(h.asset.symbol, h.asset.name) : undefined}
                      showSpark
                      onClick={() => go("asset", { symbol: h.asset.symbol })}
                      value={hideBalance ? DOTS : h.valueUsd !== undefined ? usd(h.valueUsd) : qty}
                      change={day !== undefined ? { pct: day, label: "today" } : undefined}
                      flashKey={flashed && loop ? `${h.asset.symbol}:${loop.txHash}` : undefined}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {holdings.length > TOP_HOLDINGS && (
            <button
              className="tap"
              onClick={() => go("portfolio")}
              style={{ width: "100%", marginTop: 10, padding: "11px", borderRadius: 12, background: "var(--surface-2)", fontSize: 13.5, fontWeight: 600, color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 44 }}
            >
              See all {holdings.length} holdings <Icon name="chevR" size={15} />
            </button>
          )}
        </div>

        {/* recent activity — REAL, from the on-chain executor log */}
        {recent.length > 0 && (
          <div style={{ padding: "20px 22px 0" }}>
            <SectionTitle action="See all" onAction={() => go("activity")}>
              Recent activity
            </SectionTitle>
            <div className="card" style={{ padding: "4px 14px" }}>
              {recent.map((a, i) => {
                const symbols = a.symbols ?? [];
                const when = dayLabel(a.timestamp);
                return (
                  <button
                    key={a.txHash + i}
                    className="row"
                    onClick={() =>
                      go("receipt", {
                        title: "Invested in a plan",
                        amount: a.usdc,
                        txHash: a.txHash,
                        date: a.timestamp ? new Date(a.timestamp * 1000).toISOString() : undefined,
                      })
                    }
                    style={{
                      padding: "13px 0",
                      borderBottom: i < recent.length - 1 ? "1px solid var(--line-2)" : "none",
                    }}
                  >
                    {symbols.length > 0 ? (
                      <LogoCluster assets={symbols.map((s) => ({ symbol: s }))} size={24} max={3} />
                    ) : (
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
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>Invested in a plan</div>
                      <div className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                        {when ? `${when} · ` : ""}
                        {a.legCount} {a.legCount === 1 ? "holding" : "holdings"}
                      </div>
                    </div>
                    <span className="tnum" style={{ fontWeight: 700, fontSize: 15 }}>
                      {hideBalance ? DOTS : usd(a.usdc)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* trust footer */}
        <div style={{ padding: "18px 22px 0", display: "flex", justifyContent: "center" }}>
          <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("settings")} />
        </div>
      </Reveal>
    </div>
  );
}
