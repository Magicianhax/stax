"use client";

// Portfolio — faithful re-skin of the design (screens_portfolio.jsx · Portfolio)
// wired to REAL data: holdings + approximate USD value from usePortfolio, cash
// from useUsdcBalance. Animated Donut allocation, labeled legend, holdings list,
// total (CountUp), and an empty state.
//
// Note on P&L: we don't track cost basis on-chain, so we DON'T fabricate an
// "all time" gain (the design's demo gain pill is intentionally omitted). The
// hero shows real total value; per-holding rows show approximate current value.
import { useUsdcBalance, usePortfolio, type Holding } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import {
  Icon,
  VeraOrb,
  CountUp,
  Donut,
  HoldingRow,
  SectionTitle,
  VerifiedBadge,
} from "@/components/design";
import { displayFor, toTile } from "@/lib/displayAssets";
import { usd } from "@/lib/format";

export function PortfolioScreen({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);

  const cash = bal?.value ?? 0;
  const holdings: Holding[] = port?.holdings ?? [];
  const invested = port?.totalUsd ?? 0;
  // Only holdings we could price contribute to the donut/legend share.
  const priced = holdings.filter((h) => h.valueUsd !== undefined && h.valueUsd > 0);
  const total = invested + cash;

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
          <div className="card" style={{ padding: 20, display: "flex", gap: 18, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: 90, height: 11, borderRadius: 6 }} />
              <div className="skeleton" style={{ width: 140, height: 30, borderRadius: 10, marginTop: 12 }} />
              <div className="skeleton" style={{ width: 165, height: 12, borderRadius: 6, marginTop: 14 }} />
            </div>
            <div
              className="skeleton"
              style={{ width: 104, height: 104, borderRadius: "50%", flex: "none" }}
            />
          </div>
        </div>
        <div style={{ padding: "22px 22px 0" }}>
          <div
            className="skeleton"
            style={{ width: 96, height: 16, borderRadius: 6, marginBottom: 12 }}
          />
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

  const donutTotal = priced.reduce((s, h) => s + (h.valueUsd ?? 0), 0) || 1;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      <div style={{ padding: "12px 22px 0" }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-.015em" }}>
          What you own
        </h1>
      </div>

      {/* total + donut */}
      <div className="anim-rise" style={{ padding: "14px 22px 0" }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ flex: 1 }}>
              <div className="label-eyebrow">Total value</div>
              <div
                style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.03em", marginTop: 4 }}
              >
                <CountUp to={total} />
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 8 }}>
                {usd(invested)} invested · {usd(cash)} cash
              </div>
            </div>
            <Donut
              size={104}
              thickness={15}
              segments={
                priced.length
                  ? priced.map((h) => ({
                      value: (h.valueUsd ?? 0) / donutTotal,
                      color: displayFor(h.asset.symbol, h.asset.name).color,
                    }))
                  : [{ value: 1, color: "var(--surface-2)" }]
              }
              center={
                <div>
                  <div className="tnum" style={{ fontSize: 17, fontWeight: 700, lineHeight: 1 }}>
                    {holdings.length}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: "var(--ink-2)",
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                    }}
                  >
                    held
                  </div>
                </div>
              }
            />
          </div>
          {/* legend */}
          {priced.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 16 }}>
              {priced.map((h) => {
                const d = displayFor(h.asset.symbol, h.asset.name);
                return (
                  <span
                    key={h.asset.symbol}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12.5,
                      color: "var(--ink-2)",
                    }}
                  >
                    <span
                      style={{ width: 9, height: 9, borderRadius: 3, background: d.color }}
                    />
                    {d.name}
                    <span className="tnum" style={{ color: "var(--ink-2)", fontWeight: 600 }}>
                      {Math.round(((h.valueUsd ?? 0) / donutTotal) * 100)}%
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* holdings list */}
      <div style={{ padding: "20px 22px 0" }}>
        <SectionTitle>Holdings</SectionTitle>
        <div className="card stagger-in" style={{ padding: "4px 14px" }}>
          {holdings.map((h, i) => {
            const tile = toTile(h.asset.symbol, h.asset.name);
            const d = displayFor(h.asset.symbol, h.asset.name);
            return (
              <div
                key={h.asset.symbol}
                style={{
                  borderBottom: i < holdings.length - 1 ? "1px solid var(--line-2)" : "none",
                }}
              >
                <HoldingRow
                  asset={tile}
                  sub={d.cat}
                  showSpark
                  onClick={() => go("asset", { symbol: h.asset.symbol })}
                  right={
                    <div className="tnum" style={{ fontWeight: 600, fontSize: 16 }}>
                      {h.valueUsd !== undefined
                        ? usd(h.valueUsd)
                        : `${h.qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}`}
                    </div>
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "18px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("vera")} />
      </div>
    </div>
  );
}
