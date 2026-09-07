"use client";

// Owned — the performance screen. Portfolio value over a range (1D 1W 1M 1Y All)
// as an interactive area chart with a value + date readout, the range's P&L,
// every holding with its gain for that range, and the allocation donut (centre =
// total) with a legend from the fixed brand ramp.
//
// Data: holdings + cash from usePortfolio (server-valued, rendered verbatim);
// cost basis, gains and the account's real value line from usePortfolioHistory
// (/api/portfolio/history: Vera fills + manual trades, priced from our own
// price snapshots — demo: seeded lots). The hero P&L is that real line's
// first→last when there is history for the range; before our snapshots began
// (2026-09-06) it says "since Sep 6", and with no history at all it falls back
// to the holdings' market series blended by current value ("price movement").
// Each row shows its unrealized gain against cost when the lots are known.
import { useMemo, useState } from "react";
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { coverageLabel, rangeCovered, usePortfolioHistory } from "@/hooks/usePortfolioHistory";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import {
  Icon,
  VeraOrb,
  Donut,
  HoldingRow,
  PriceChart,
  SectionTitle,
  VerifiedBadge,
  type PricePoint,
} from "@/components/design";
import { Money, Reveal, formatMoney } from "@/components/motion";
import { toTile } from "@/lib/displayAssets";
import { usd, tokenQty } from "@/lib/format";
import { rampColor } from "./basketPrimitives";
import { blendSeries, changeOf, readoutDate, useSymbolSeries, type MarketRange } from "./useRangeSeries";
import type { LoopParams } from "../LiteApp";

const RANGES = ["1D", "1W", "1M", "1Y", "5Y"] as const;
const RANGE_WORD: Record<MarketRange, string> = {
  "1D": "today",
  "1W": "past week",
  "1M": "past month",
  "1Y": "past year",
  "5Y": "past 5 years",
};

export function PortfolioScreen({
  go,
  loop,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
  loop?: LoopParams;
}) {
  const { address } = useSmartAccount();
  // Cash, invested, and total all arrive pre-computed from /api/portfolio —
  // this screen renders them verbatim (no client-side money math).
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);

  const cash = port?.cashUsd ?? 0;
  const holdings: Holding[] = port?.holdings ?? [];
  const invested = port?.investedUsd ?? 0;
  // Only holdings we could price contribute to the chart/donut.
  const priced = holdings.filter((h) => h.valueUsd !== undefined && h.valueUsd > 0);
  const total = port?.totalUsd ?? 0;

  const [range, setRange] = useState<MarketRange>("1M");
  const [hover, setHover] = useState<(PricePoint & { index: number }) | null>(null);
  const symbols = useMemo(() => priced.map((h) => h.asset.symbol), [priced]);
  const { series, loading: seriesLoading } = useSymbolSeries(symbols, range);
  const { data: hist } = usePortfolioHistory(address ?? undefined, range);

  // Market-series estimate: each holding's series scaled to its current value,
  // plus flat cash — ends exactly at the real total. Used when we have no
  // value history of our own for the range.
  const estimate = useMemo(
    () =>
      blendSeries(
        priced.map((h) => ({ points: series.get(h.asset.symbol) ?? [], weight: h.valueUsd ?? 0 })),
        { base: cash, anchor: "end" },
      ),
    [priced, series, cash],
  );
  // The real line: account value at each of our price snapshots (cash and
  // quantities from the lots), ending at live prices.
  const real = hist && hist.series.length > 1 ? hist.series : null;
  const points = real ?? estimate;
  const pnl = changeOf(points);
  const up = pnl.abs >= 0;
  const covered = hist ? rangeCovered(hist.coverageFrom, range) : false;
  const sinceLabel = hist?.coverageFrom ? `since ${coverageLabel(hist.coverageFrom)}` : null;
  // What the P&L line means: the range when fully covered; "since Sep 6" when
  // our history starts inside the range; "price movement" for the estimate.
  const pnlWord = real ? (covered ? RANGE_WORD[range] : (sinceLabel ?? RANGE_WORD[range])) : `price movement ${RANGE_WORD[range]}`;
  const totals = hist && hist.totals.costBasisUsd > 0 ? hist.totals : null;
  const positions = useMemo(() => new Map((hist?.positions ?? []).map((p) => [p.symbol, p])), [hist]);

  // ── First-load skeleton — don't flash the empty state before holdings resolve.
  if (portLoading && holdings.length === 0) {
    return (
      <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
        <div style={{ padding: "12px 22px 0" }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-.015em" }}>
            What you own
          </h1>
        </div>
        <div style={{ padding: "14px 22px 0" }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="skeleton" style={{ width: 90, height: 11, borderRadius: 6 }} />
            <div className="skeleton" style={{ width: 160, height: 30, borderRadius: 10, marginTop: 12 }} />
            <div className="skeleton" style={{ width: 130, height: 12, borderRadius: 6, marginTop: 12 }} />
            <div className="skeleton" style={{ width: "100%", height: 170, borderRadius: 14, marginTop: 16 }} />
          </div>
        </div>
        <div style={{ padding: "22px 22px 0" }}>
          <div className="skeleton" style={{ width: 96, height: 16, borderRadius: 6, marginBottom: 12 }} />
          <div className="card" style={{ padding: "8px 16px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "12px 0",
                  borderBottom: i < 2 ? "1px solid var(--line-2)" : "none",
                }}
              >
                <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 13, flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "55%", height: 13, borderRadius: 6 }} />
                  <div className="skeleton" style={{ width: "34%", height: 11, borderRadius: 6, marginTop: 8 }} />
                </div>
                <div className="skeleton" style={{ width: 56, height: 16, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (holdings.length === 0) {
    return (
      <div
        className="screen screen-pad-top"
        style={{
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 36px 110px",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 22,
            background: "var(--surface-2)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
            marginBottom: 20,
          }}
        >
          <Icon name="trend" size={34} />
        </div>
        <h2 className="serif" style={{ fontSize: 26, margin: "0 0 8px" }}>
          Nothing owned yet
        </h2>
        <p style={{ fontSize: 15.5, color: "var(--ink-2)", margin: "0 0 24px", lineHeight: 1.5 }}>
          When you invest, the companies and funds you own will show up here.
        </p>
        <button className="btn btn-primary tap" style={{ padding: "0 30px" }} onClick={() => go("goal")}>
          <VeraOrb size={24} /> Start with Vera
        </button>
      </div>
    );
  }

  const donutTotal = priced.reduce((s, h) => s + (h.valueUsd ?? 0), 0) + cash || 1;
  const legend = [
    ...priced.map((h, i) => ({
      key: h.asset.symbol,
      name: toTile(h.asset.symbol, h.asset.name).name,
      value: h.valueUsd ?? 0,
      color: rampColor(i),
    })),
    ...(cash > 0 ? [{ key: "cash", name: "Cash", value: cash, color: "color-mix(in srgb, var(--ink-3) 45%, var(--surface-2))" }] : []),
  ];
  const chartReady = points.length > 1;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      <div style={{ padding: "12px 22px 0" }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-.015em" }}>
          What you own
        </h1>
      </div>

      <Reveal once="owned">
        {/* performance hero: readout + range chart */}
        <div style={{ padding: "14px 22px 0" }}>
          <div className="card" style={{ padding: "18px 16px 12px" }}>
            <div style={{ padding: "0 4px" }}>
              <div className="label-eyebrow" aria-live="polite">
                {hover ? readoutDate(hover.t, range) : "Total value"}
              </div>
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.03em", marginTop: 4, minHeight: 41 }}>
                {hover ? (
                  <span className="tnum">{usd(hover.v)}</span>
                ) : (
                  <Money value={total} prev={loop?.prevTotal} />
                )}
              </div>
              <div className="tnum" style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6, minHeight: 20 }}>
                {chartReady ? (
                  <>
                    <span style={{ color: up ? "var(--pos)" : "var(--neg)" }}>
                      {up ? "+" : "-"}
                      <Money value={Math.abs(pnl.abs)} /> · {up ? "+" : ""}
                      {pnl.pct.toFixed(2)}%
                    </span>
                    <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>{pnlWord}</span>
                  </>
                ) : (
                  <span className="skeleton" style={{ display: "inline-block", width: 150, height: 14, borderRadius: 6 }} />
                )}
              </div>
              {totals && (
                <div
                  className="tnum"
                  style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 5, lineHeight: 1.45 }}
                  aria-label={`Cost basis ${usd(totals.costBasisUsd)}, unrealized ${usd(totals.unrealizedUsd)}, realized ${usd(totals.realizedUsd)}`}
                >
                  Cost basis {usd(totals.costBasisUsd)} · Unrealized{" "}
                  <span style={{ color: totals.unrealizedUsd >= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 600 }}>
                    {totals.unrealizedUsd >= 0 ? "+" : "-"}
                    {usd(Math.abs(totals.unrealizedUsd))} ({totals.unrealizedUsd >= 0 ? "+" : ""}
                    {((totals.unrealizedUsd / totals.costBasisUsd) * 100).toFixed(2)}%)
                  </span>{" "}
                  · Realized {totals.realizedUsd < 0 ? "-" : ""}
                  {usd(Math.abs(totals.realizedUsd))}
                </div>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              {chartReady ? (
                <PriceChart
                  points={points}
                  up={up}
                  area
                  height={170}
                  ranges={RANGES}
                  range={range}
                  onRange={(r) => {
                    setHover(null);
                    setRange(r as MarketRange);
                  }}
                  onScrub={setHover}
                  formatValue={(v) => usd(v)}
                  label={`Your portfolio value, ${up ? "up" : "down"} ${Math.abs(pnl.pct).toFixed(1)}% ${RANGE_WORD[range]}`}
                />
              ) : (
                <div
                  className={seriesLoading ? "skeleton" : undefined}
                  style={{ height: 170, borderRadius: 14, display: "grid", placeItems: "center", background: seriesLoading ? undefined : "var(--surface-2)", color: "var(--ink-2)", fontSize: 13.5, fontWeight: 600 }}
                >
                  {!seriesLoading && "Not enough history to draw yet"}
                </div>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "10px 4px 0", lineHeight: 1.45 }}>
              {usd(invested)} invested · {usd(cash)} cash.{" "}
              {real
                ? covered
                  ? "Change is your gain over the range, not deposits."
                  : `Your history starts ${sinceLabel?.replace("since ", "") ?? "recently"}; change is since then.`
                : "Change is price movement over the range."}
            </div>
          </div>
        </div>

        {/* holdings — each with its gain for the selected range */}
        <div style={{ padding: "20px 22px 0" }}>
          <SectionTitle>Holdings</SectionTitle>
          <div className="card" style={{ padding: "4px 14px" }}>
            {holdings.map((h, i) => {
              const base = toTile(h.asset.symbol, h.asset.name);
              // Real 1D market data (from the server) replaces the presentational
              // tint whenever the asset has a live source.
              const tile = {
                ...base,
                day: h.dayChangePct ?? base.day,
                spark: h.spark ?? base.spark,
              };
              const s = series.get(h.asset.symbol);
              const rc = s && s.length > 1 ? changeOf(s) : null;
              // Gain for the range on today's value: value − value / (1 + pct).
              const abs = rc && h.valueUsd !== undefined ? h.valueUsd - h.valueUsd / (1 + rc.pct / 100) : undefined;
              // Unrealized gain against what was paid, when the lots are known.
              const pos = positions.get(h.asset.symbol);
              const gain =
                pos && pos.unrealizedUsd !== null && pos.unrealizedPct !== null && pos.costBasisUsd > 0
                  ? { abs: pos.unrealizedUsd, pct: pos.unrealizedPct, label: "vs cost" }
                  : null;
              const qty = tokenQty(h.raw, h.asset.decimals ?? 18);
              const flashed = loop?.flash.includes(h.asset.symbol);
              return (
                <div
                  key={h.asset.symbol}
                  style={{ borderBottom: i < holdings.length - 1 ? "1px solid var(--line-2)" : "none" }}
                >
                  <HoldingRow
                    asset={tile}
                    qty={qty}
                    symbol={h.asset.symbol}
                    showSpark={false}
                    onClick={() => go("asset", { symbol: h.asset.symbol })}
                    value={h.valueUsd !== undefined ? usd(h.valueUsd) : qty}
                    change={
                      gain ??
                      (rc
                        ? { abs, pct: rc.pct, label: range === "1D" ? "today" : range }
                        : h.dayChangePct !== undefined
                          ? { pct: h.dayChangePct, label: "today" }
                          : undefined)
                    }
                    flashKey={flashed && loop ? `${h.asset.symbol}:${loop.txHash}` : undefined}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* allocation — donut centre is the total; legend from the brand ramp */}
        <div style={{ padding: "20px 22px 0" }}>
          <SectionTitle>Allocation</SectionTitle>
          <div className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 18 }}>
            <Donut
              size={112}
              thickness={15}
              segments={legend.map((l) => ({ value: l.value / donutTotal, color: l.color }))}
              center={
                <div>
                  <div className="tnum" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1, letterSpacing: "-.02em" }}>
                    {formatMoney(total, "USD", 0)}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: "var(--ink-2)",
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      marginTop: 3,
                    }}
                  >
                    total
                  </div>
                </div>
              }
            />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
              {legend.map((l) => (
                <div
                  key={l.key}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-2)" }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: l.color, flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.name}
                  </span>
                  <span className="tnum" style={{ color: "var(--ink)", fontWeight: 600 }}>
                    {Math.round((l.value / donutTotal) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: "18px 22px 0", display: "flex", justifyContent: "center" }}>
          <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("vera")} />
        </div>
      </Reveal>
    </div>
  );
}
