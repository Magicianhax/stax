"use client";

// AssetDetail — Pro asset view (screens_pro.jsx · AssetDetail). Shows a REAL
// price chart (/api/market: Yahoo Finance for the equities our tokenized stocks
// track, CoinGecko for the token tier), plain-language about copy, and the user's
// REAL position in this asset (from usePortfolio). Buy/Sell open the manual Trade
// screen (useQuote + useSwap, gasless) — manual trades don't need the executor,
// so they work even while a chain's Stax contracts are still being switched on.
// Assets with no liquid market yet are tagged "Coming soon" with the buy disabled
// and the reason spelled out.
import { useState } from "react";
import type { Asset } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { usePortfolio } from "@/hooks/useBalances";
import { useAssetPrice } from "@/hooks/usePrices";
import { useMarketHistory, type MarketRange } from "@/hooks/useMarket";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { displayFor } from "@/lib/displayAssets";
import { Icon, AssetTile, PriceChart, SectionTitle, Stat, MarketStatus } from "@/components/design";
import { usd, tokenQty, timeAgo } from "@/lib/format";
import { iconBtn } from "./primitives";
import { ComingTag, yieldLine } from "./MarketScreen";

const RANGES = ["1D", "1W", "1M", "1Y", "All"];

/** One key-fact row; `wide` stacks label over value for sentence-length facts. */
interface Fact {
  k: string;
  v: string;
  wide?: boolean;
}

export function AssetDetailScreen({
  go,
  symbol,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol: string;
}) {
  const chain = useChain();
  const asset: Asset = chain.assets.all.find((a) => a.symbol === symbol) ?? chain.assets.all[0];
  const d = displayFor(asset.symbol, asset.name);
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const holding = port?.holdings.find((h) => h.asset.symbol === asset.symbol);
  const { price: live } = useAssetPrice(asset.symbol);
  const livePrice = live?.priceUsd;
  const liveApy = live?.apy;
  const shownPrice = livePrice ?? d.price;
  const safe = asset.tier === "safe";
  const stock = asset.tier === "stock";
  // Coinbase B20 stocks (Base): dividends grow the token instead of paying cash.
  const coinbaseStock = stock && chain.key === "base";
  const yieldText = safe ? yieldLine(liveApy, d.apy) : undefined;
  const coming = Boolean(asset.coming || d.coming);
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
  const facts: Fact[] = [
    { k: "Type", v: TYPE_LABEL[d.kind ?? "stock"] ?? "Stock" },
    { k: "Category", v: d.cat },
    ...(yieldText
      ? [{ k: "Rate", v: yieldText.replace("earns ", "").replace(" · rate can change", ", can change") }]
      : d.apy
        ? [{ k: "Rate", v: `about ${d.apy.replace("~", "")} a year, can change` }]
        : []),
    // Reference price = the last official stock-market price (Chainlink), with
    // its age — it only moves while the market is open, so "2h ago" is honest.
    ...(live?.marketPrice !== undefined
      ? [
          {
            k: "Reference price",
            v: `${usd(live.marketPrice)}${live.marketPriceAt ? ` · updated ${timeAgo(live.marketPriceAt)}` : ""}`,
          },
        ]
      : []),
    { k: "Held as", v: heldAs },
    ...(live?.sharesPerToken !== undefined && live.sharesPerToken !== 1
      ? [{ k: "Shares per token", v: `1 token = ${live.sharesPerToken.toFixed(2)} shares` }]
      : []),
    ...(coinbaseStock
      ? [{ k: "Dividends", v: "Reinvested automatically — your token grows instead of paying cash", wide: true }]
      : []),
    ...(stock ? [{ k: "Issued by", v: chain.issuer.replace(" tokenized stocks", "") }] : []),
    { k: "Network", v: chain.name },
  ];
  const reason = coming
    ? `Not buyable on ${chain.name} yet: there’s no liquid market for it. We’ll switch it on as soon as there is.`
    : undefined;

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em", overflowWrap: "anywhere" }}>{d.name}</h1>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
            {(d.ticker ?? asset.symbol) + " · " + d.cat}
          </div>
        </div>
        {coming && <ComingTag long />}
      </div>

      {/* price */}
      <div style={{ padding: "18px 22px 0" }}>
        <div className="tnum" style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-.03em" }}>
          {shownPrice !== undefined ? usd(shownPrice) : "—"}
        </div>
        {safe ? (
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink-2)", marginTop: 2 }}>
            {yieldText ?? "a dollar that stays a dollar"}
          </div>
        ) : (
          <div
            className="tnum"
            style={{ fontSize: 14.5, fontWeight: 700, color: winUp ? "var(--pos)" : "var(--neg)", marginTop: 2 }}
          >
            {(winUp ? "+" : "") + rangeChange.toFixed(2)}%{" "}
            <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>· {RANGES[r]}</span>
          </div>
        )}
        {/* stock-market clock — only stocks have a market that closes */}
        {stock && (
          <div style={{ marginTop: 14 }}>
            <MarketStatus detail />
          </div>
        )}
      </div>

      {/* chart */}
      <div className="anim-rise" style={{ animationDelay: ".05s", padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: "16px 14px 12px" }}>
          <PriceChart
            data={sparkData}
            up={winUp}
            height={216}
            ranges={RANGES}
            range={RANGES[r]}
            onRange={(rr) => setR(RANGES.indexOf(rr))}
            label={`${d.name} price chart, ${winUp ? "up" : "down"} ${Math.abs(rangeChange).toFixed(1)}% over ${RANGES[r]}`}
          />
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
              label={asset.tier === "stock" ? "Shares" : "Amount"}
              value={tokenQty(holding.raw, asset.decimals ?? 18)}
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
                flexDirection: f.wide ? "column" : "row",
                justifyContent: "space-between",
                alignItems: f.wide ? "stretch" : "center",
                gap: f.wide ? 3 : 16,
                padding: "12px 0",
                borderTop: i ? "1px solid var(--line-2)" : "none",
                fontSize: 14.5,
              }}
            >
              <span style={{ color: "var(--ink-2)", flex: "none" }}>{f.k}</span>
              <span style={{ fontWeight: 600, color: "var(--ink)", textAlign: f.wide ? "left" : "right", lineHeight: 1.4 }}>
                {f.v}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA — manual buy/sell (no executor needed). Disabled with the reason
          when there's no liquid market yet. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "16px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)",
        }}
      >
        {reason && (
          <p role="status" style={{ margin: "0 0 10px", textAlign: "center", fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {reason}
          </p>
        )}
        <div style={{ display: "flex", gap: 10 }}>
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
    </div>
  );
}
