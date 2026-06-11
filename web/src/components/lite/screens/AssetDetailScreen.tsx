"use client";

// AssetDetail — Pro asset view (screens_pro.jsx · AssetDetail). Shows a REAL
// price chart (/api/market: Yahoo Finance for the equities our xStocks track,
// CoinGecko for the token tier), plain-language about copy, and the user's REAL
// position in this asset (from usePortfolio). Buy/Sell open the manual Trade
// screen (useQuote + useSwap, gasless). Tiers the executor can't route yet are
// flagged "Coming soon".
import { useState } from "react";
import { ALL_ASSETS, type Asset } from "@/lib/mantle";
import { usePortfolio } from "@/hooks/useBalances";
import { usePrice } from "@/hooks/usePrices";
import { useMarketHistory, type MarketRange } from "@/hooks/useMarket";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { displayFor } from "@/lib/displayAssets";
import { Icon, AssetTile, PriceChart, SectionTitle, Stat } from "@/components/design";
import { usd } from "@/lib/format";
import { iconBtn } from "./primitives";

const RANGES = ["1D", "1W", "1M", "1Y", "All"];

export function AssetDetailScreen({
  go,
  symbol,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol: string;
}) {
  const asset: Asset = ALL_ASSETS.find((a) => a.symbol === symbol) ?? ALL_ASSETS[0];
  const d = displayFor(asset.symbol, asset.name);
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const holding = port?.holdings.find((h) => h.asset.symbol === asset.symbol);
  const { priceUsd: livePrice } = usePrice(asset.symbol);
  const shownPrice = livePrice ?? d.price;
  const coming = Boolean(d.coming);
  const [r, setR] = useState(2);

  // REAL market history for the selected range (server-cached; keepPreviousData
  // makes range switches seamless). Assets with no live source (or an upstream
  // outage) fall back to the windowed reference series so the chart never blanks.
  const { data: market } = useMarketHistory(asset.symbol, RANGES[r] as MarketRange);
  const RANGE_FRAC = [0.18, 0.38, 0.6, 0.82, 1];
  const fallbackSpark = (() => {
    const s = d.spark ?? [];
    if (s.length < 2) return s;
    const n = Math.max(2, Math.round(s.length * (RANGE_FRAC[r] ?? 1)));
    return s.slice(s.length - n);
  })();
  const sparkData = market?.series ?? fallbackSpark;
  // Change across the selected range — real when we have market data (1D is vs
  // the previous session's close, like a broker shows it).
  const rangeChange =
    market?.changePct ??
    (sparkData.length > 1
      ? ((sparkData[sparkData.length - 1] - sparkData[0]) / sparkData[0]) * 100
      : d.day);
  const winUp = rangeChange >= 0;

  // Key facts under About — a clean label/value list (not fat pill cards).
  const TYPE_LABEL: Record<string, string> = {
    stock: "Stock",
    fund: "Fund · ETF",
    safe: "Cash · earns yield",
    crypto: "Crypto",
  };
  const heldAs =
    d.kind === "crypto" ? "Tokenized coin" : d.kind === "safe" ? "Yield account" : "Real shares";
  const facts: { k: string; v: string }[] = [
    { k: "Type", v: TYPE_LABEL[d.kind ?? "stock"] ?? "Stock" },
    { k: "Category", v: d.cat },
    ...(d.apy ? [{ k: "Yield", v: `${d.apy} a year` }] : []),
    { k: "Held as", v: heldAs },
    { k: "Network", v: "Mantle" },
  ];

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
      </div>

      <div
        className="anim-rise"
        style={{ padding: "12px 22px 0", display: "flex", alignItems: "center", gap: 14 }}
      >
        <AssetTile asset={d} size={54} />
        <div style={{ flex: 1 }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>{d.name}</h1>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
            {(d.ticker ?? asset.symbol) + " · " + d.cat}
          </div>
        </div>
        {coming && (
          <span
            className="chip"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            Coming soon
          </span>
        )}
      </div>

      {/* price */}
      <div style={{ padding: "18px 22px 0" }}>
        <div className="tnum" style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-.03em" }}>
          {shownPrice !== undefined ? usd(shownPrice) : "—"}
        </div>
        <div
          className="tnum"
          style={{ fontSize: 14.5, fontWeight: 700, color: winUp ? "var(--pos)" : "var(--neg)", marginTop: 2 }}
        >
          {(winUp ? "+" : "") + rangeChange.toFixed(2)}%{" "}
          <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>· {RANGES[r]}</span>
        </div>
      </div>

      {/* chart */}
      <div className="anim-rise" style={{ animationDelay: ".05s", padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: "16px 14px 12px" }}>
          <PriceChart
            data={sparkData}
            up={winUp}
            height={216}
            label={`${d.name} price chart, ${winUp ? "up" : "down"} ${Math.abs(rangeChange).toFixed(1)}% over ${RANGES[r]}`}
          />
          {/* range selector — sliding-thumb segmented control */}
          <div className="seg" style={{ marginTop: 14, background: "var(--surface-2)" }}>
            <span
              className="seg-thumb"
              style={{
                width: `calc((100% - 8px) / ${RANGES.length})`,
                left: 4,
                transform: `translateX(calc(${r} * 100%))`,
              }}
            />
            {RANGES.map((rr, idx) => (
              <button
                key={rr}
                onClick={() => setR(idx)}
                className={`seg-item ${r === idx ? "is-on" : ""}`}
                style={{ height: 32, fontSize: 13 }}
              >
                {rr}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* your position */}
      {holding && (
        <div style={{ padding: "18px 22px 0" }}>
          <SectionTitle>Your position</SectionTitle>
          <div className="card" style={{ padding: 18, display: "flex", gap: 16 }}>
            <Stat
              label="Value"
              value={holding.valueUsd !== undefined ? usd(holding.valueUsd) : "—"}
            />
            <Stat
              label="Shares"
              value={holding.qty.toLocaleString("en-US", { maximumFractionDigits: 4 })}
            />
            {shownPrice !== undefined && (
              <Stat label="Price" value={usd(shownPrice)} />
            )}
          </div>
        </div>
      )}

      {/* about — heading + prose share the same left edge (no card wrapper). */}
      <div style={{ padding: "18px 22px 0" }}>
        <SectionTitle>About</SectionTitle>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
          {d.desc}
        </p>

        {/* key facts — tidy label/value list */}
        <div className="card" style={{ marginTop: 14, padding: "4px 16px" }}>
          {facts.map((f, i) => (
            <div
              key={f.k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                padding: "12px 0",
                borderTop: i ? "1px solid var(--line-2)" : "none",
                fontSize: 14.5,
              }}
            >
              <span style={{ color: "var(--ink-2)" }}>{f.k}</span>
              <span style={{ fontWeight: 600, color: "var(--ink)", textAlign: "right" }}>{f.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "16px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)",
          display: "flex",
          gap: 10,
        }}
      >
        <button
          className="btn btn-ghost tap"
          style={{ flex: 1 }}
          disabled={!holding || coming}
          onClick={() => go("trade", { symbol: asset.symbol, side: "sell" })}
        >
          Sell
        </button>
        <button
          className="btn btn-primary tap"
          style={{ flex: 2 }}
          disabled={coming}
          onClick={() => go("trade", { symbol: asset.symbol, side: "buy" })}
        >
          {coming ? "Coming soon" : "Buy"}
        </button>
      </div>
    </div>
  );
}
