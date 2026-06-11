"use client";

// Market — Pro asset browser (screens_pro.jsx · Market). A searchable list of
// the REAL ALL_ASSETS universe (lib/mantle.ts), categorised + decorated with
// plain-language display copy (displayAssets.ts). Prices are live on-chain spot;
// day moves + sparklines are real market data (/api/market). Safe/crypto tiers
// that the executor can't route as one-tap manual buys yet are dimmed + "Soon".
import { useMemo, useState } from "react";
import { ALL_ASSETS } from "@/lib/mantle";
import { displayFor } from "@/lib/displayAssets";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { Icon, AssetTile, Sparkline } from "@/components/design";
import { usd } from "@/lib/format";

const CATS = ["All", "Big tech", "Funds", "Safer", "Crypto", "More"] as const;

export function MarketScreen({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  const { data: prices } = usePrices();
  const { data: marketData } = useMarketSummary();

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return ALL_ASSETS.map((asset) => ({ asset, d: displayFor(asset.symbol, asset.name) }))
      .filter(
        ({ asset, d }) =>
          (cat === "All" || d.cat === cat) &&
          (d.name.toLowerCase().includes(query) ||
            asset.symbol.toLowerCase().includes(query)),
      )
      // Buyable assets first; "coming soon" ones sink to the bottom (stable sort
      // keeps each group's original order, so available items aren't sandwiched).
      .sort((a, b) => Number(Boolean(a.d.coming)) - Number(Boolean(b.d.coming)));
  }, [q, cat]);

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      <div style={{ padding: "12px 22px 0" }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-.015em" }}>Market</h1>
      </div>

      {/* search */}
      <div style={{ padding: "14px 22px 0" }}>
        <div
          className="field"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 15px",
          }}
        >
          <Icon name="search" size={20} style={{ color: "var(--ink-3)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search companies & funds"
            aria-label="Search companies and funds"
            style={{ flex: 1, fontSize: 16 }}
          />
        </div>
      </div>

      {/* categories */}
      <div
        style={{ display: "flex", gap: 8, padding: "14px 22px 4px", overflowX: "auto", flexShrink: 0 }}
      >
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`chip tap ${cat === c ? "is-on" : ""}`}
            style={{ flex: "none" }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* list */}
      <div style={{ padding: "8px 22px 0" }} className="stagger">
        {list.map(({ asset, d }) => {
          // Real market day move + sparkline when the asset has a live source;
          // fall back to the presentational reference so rows never blank.
          const live = marketData?.summary[asset.symbol];
          const day = live?.dayChangePct ?? d.day;
          const spark = live?.spark ?? d.spark;
          const up = day >= 0;
          // Real on-chain spot when available; fall back to the indicative reference.
          const livePrice = prices?.prices[asset.symbol]?.priceUsd;
          const shownPrice = livePrice ?? d.price;
          return (
            <button
              key={asset.symbol}
              onClick={() => go("asset", { symbol: asset.symbol })}
              className="card tap"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "12px 14px",
                marginBottom: 9,
                display: "flex",
                alignItems: "center",
                gap: 13,
                opacity: d.coming ? 0.62 : 1,
              }}
            >
              <AssetTile asset={d} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontWeight: 600, fontSize: 16 }}>{d.name}</span>
                  {d.coming && (
                    <span
                      className="chip"
                      style={{
                        height: 20,
                        padding: "0 8px",
                        fontSize: 10.5,
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                      }}
                    >
                      Soon
                    </span>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {d.ticker ?? asset.symbol}
                  {d.apy ? ` · ${d.apy} a year` : ""}
                </div>
              </div>
              <Sparkline data={spark} color={up ? "var(--pos)" : "var(--neg)"} />
              <div style={{ textAlign: "right", minWidth: 70 }}>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 15.5 }}>
                  {shownPrice !== undefined ? usd(shownPrice) : "—"}
                </div>
                <div
                  className="tnum"
                  style={{ fontSize: 12.5, fontWeight: 600, color: up ? "var(--pos)" : "var(--neg)" }}
                >
                  {(up ? "+" : "") + day.toFixed(2)}%
                </div>
              </div>
            </button>
          );
        })}
        {list.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--ink-2)", padding: "34px 30px", fontSize: 14.5 }}>
            No companies or funds match that.
          </p>
        )}
      </div>
    </div>
  );
}
