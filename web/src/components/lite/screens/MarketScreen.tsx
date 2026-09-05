"use client";

// Market — Pro asset browser (screens_pro.jsx · Market). Lists the REAL asset
// universe of the active chain (lib/chains), grouped by tier — Stocks, Funds
// (Mantle only), Safe dollars, Crypto — and decorated with plain-language display
// copy (displayAssets.ts). Prices are live venue spot; day moves + sparklines are
// real market data (/api/market); Safe dollars show the live supply rate. Assets
// with no liquid market yet are listed with a quiet "Coming soon" tag (the buy is
// disabled on the asset page, with the reason). Searching or picking a category
// flattens the groups into one list.
import { useMemo, useState } from "react";
import type { Asset } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { displayFor, type AssetDisplay } from "@/lib/displayAssets";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { Icon, AssetTile, Sparkline, SectionTitle } from "@/components/design";
import { usd } from "@/lib/format";

const CATS = ["All", "Big tech", "Funds", "Safer", "Crypto", "More"] as const;
type Cat = (typeof CATS)[number];

interface Row {
  asset: Asset;
  d: AssetDisplay;
}

/** Tier groups in display order. Funds only exist on Mantle; empty groups are skipped. */
const GROUPS: { key: string; title: string; pick: (r: Row) => boolean }[] = [
  { key: "stocks", title: "Stocks", pick: (r) => r.asset.tier === "stock" && r.d.kind !== "fund" },
  { key: "funds", title: "Funds", pick: (r) => r.d.kind === "fund" },
  { key: "safe", title: "Safe dollars", pick: (r) => r.asset.tier === "safe" },
  { key: "crypto", title: "Crypto", pick: (r) => r.asset.tier === "crypto" },
];

/** Plain-language yield line for the safe tier: live Aave rate when we have it. */
export function yieldLine(liveApy: number | undefined, fallback?: string, short = false): string | undefined {
  const rate =
    liveApy !== undefined && Number.isFinite(liveApy) ? `${liveApy.toFixed(1)}%` : fallback?.replace("~", "");
  if (!rate) return undefined;
  return short ? `about ${rate} a year, can change` : `earns about ${rate} a year · rate can change`;
}

export function MarketScreen({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("All");
  const chain = useChain();
  const { data: prices } = usePrices();
  const { data: marketData } = useMarketSummary();

  // Every asset on this chain with its display record; "coming" ones sink to the
  // bottom of their group (stable sort keeps the registry order otherwise).
  const rows = useMemo<Row[]>(
    () =>
      chain.assets.all
        .map((asset) => ({ asset, d: displayFor(asset.symbol, asset.name) }))
        .sort((a, b) => Number(Boolean(a.asset.coming || a.d.coming)) - Number(Boolean(b.asset.coming || b.d.coming))),
    [chain],
  );

  const query = q.trim().toLowerCase();
  const filtering = query.length > 0 || cat !== "All";
  const filtered = useMemo(
    () =>
      rows.filter(
        ({ asset, d }) =>
          (cat === "All" || d.cat === cat) &&
          (d.name.toLowerCase().includes(query) || asset.symbol.toLowerCase().includes(query)),
      ),
    [rows, cat, query],
  );

  const renderRow = ({ asset, d }: Row) => {
    // Real market day move + sparkline when the asset has a live source; fall
    // back to the presentational reference so rows never blank.
    const live = marketData?.summary[asset.symbol];
    const day = live?.dayChangePct ?? d.day;
    const spark = live?.spark ?? d.spark;
    const up = day >= 0;
    // Real venue spot when available; fall back to the indicative reference.
    const p = prices?.prices[asset.symbol];
    const shownPrice = p?.priceUsd ?? d.price;
    const coming = Boolean(asset.coming || d.coming);
    const safe = asset.tier === "safe";
    const sub = safe ? yieldLine(p?.apy, d.apy, true) ?? (d.ticker ?? asset.symbol) : (d.ticker ?? asset.symbol);
    return (
      <button
        key={asset.symbol}
        onClick={() => go("asset", { symbol: asset.symbol })}
        className="card tap"
        aria-label={`${d.name}${coming ? ", coming soon" : ""}`}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 14px",
          marginBottom: 9,
          display: "flex",
          alignItems: "center",
          gap: 13,
        }}
      >
        {/* dim the tile, never the words — text stays AA on a "coming" row */}
        <span style={{ opacity: coming ? 0.55 : 1, display: "block", flex: "none" }}>
          <AssetTile asset={d} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 16,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {d.name}
            </span>
            {coming && <ComingTag />}
          </div>
          <div
            className={safe ? undefined : "mono"}
            style={{
              fontSize: safe ? 12.5 : 12,
              color: "var(--ink-2)",
              marginTop: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </div>
        </div>
        {!coming && !safe && <Sparkline data={spark} color={up ? "var(--pos)" : "var(--neg)"} />}
        <div style={{ textAlign: "right", minWidth: 70 }}>
          <div className="tnum" style={{ fontWeight: 600, fontSize: 15.5, color: coming ? "var(--ink-2)" : "var(--ink)" }}>
            {shownPrice !== undefined ? usd(shownPrice) : "—"}
          </div>
          {!coming && !safe && (
            <div
              className="tnum"
              style={{ fontSize: 12.5, fontWeight: 600, color: up ? "var(--pos)" : "var(--neg)" }}
            >
              {(up ? "+" : "") + day.toFixed(2)}%
            </div>
          )}
        </div>
      </button>
    );
  };

  const groups = GROUPS.map((g) => ({ ...g, rows: rows.filter(g.pick) })).filter((g) => g.rows.length > 0);

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      <div style={{ padding: "12px 22px 0", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-.015em" }}>Market</h1>
        <span style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}>{chain.issuer}</span>
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

      {/* categories — scroll row; the trailing spacer keeps the last chip off the edge */}
      <div
        style={{ display: "flex", gap: 8, padding: "14px 0 4px 22px", overflowX: "auto", flexShrink: 0 }}
      >
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            aria-pressed={cat === c}
            className={`chip tap ${cat === c ? "is-on" : ""}`}
            style={{ flex: "none" }}
          >
            {c}
          </button>
        ))}
        <span aria-hidden style={{ flex: "none", width: 14 }} />
      </div>

      {filtering ? (
        <div style={{ padding: "8px 22px 0" }} className="stagger">
          {filtered.map(renderRow)}
          {filtered.length === 0 && (
            <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)", marginTop: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Nothing matches that</div>
              <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
                Try a company name like Apple, or clear the filter to see everything on {chain.name}.
              </div>
            </div>
          )}
        </div>
      ) : (
        groups.map((g, gi) => (
          <div key={g.key} style={{ padding: `${gi === 0 ? 10 : 16}px 22px 0` }}>
            <SectionTitle>{g.title}</SectionTitle>
            <div className="stagger">{g.rows.map(renderRow)}</div>
          </div>
        ))
      )}
    </div>
  );
}

// Quiet "Coming soon" tag — recessed surface + secondary ink (AA), never the
// terracotta accent, which is reserved for trust signals.
export function ComingTag({ long = false }: { long?: boolean }) {
  return (
    <span
      className="chip"
      style={{
        height: 22,
        padding: "0 9px",
        fontSize: 11,
        fontWeight: 600,
        background: "var(--surface-2)",
        boxShadow: "none",
        color: "var(--ink-2)",
        flex: "none",
      }}
    >
      {long ? "Coming soon" : "Soon"}
    </span>
  );
}
