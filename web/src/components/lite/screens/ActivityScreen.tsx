"use client";

// Activity & receipts — a user's REAL on-chain Stax history (useActivity),
// newest first, grouped by day, each row opening its on-chain receipt. Rows
// show the plan's holdings as a logo cluster; pending and failed plans are
// stated plainly. Reached from Home's header and from Settings.
//
// Below your own history sits Vera's public record, which used to be a screen of
// its own: what $100 following every plan would be worth, and the plans she has
// recorded for everyone. Both are history, so they belong on the history screen —
// and both are labelled as hers, not yours.
import { useMemo, useState } from "react";
import { useActivity, type ActivityRow } from "@/hooks/useActivity";
import { useVeraRecord } from "@/hooks/useVeraRecord";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useDemo } from "@/components/demo/DemoProvider";
import { Icon, LogoCluster, PriceChart, SectionTitle, Sparkline, VerifiedBadge, type PricePoint } from "@/components/design";
import { Reveal } from "@/components/motion";
import { riskLabel, usd } from "@/lib/format";
import { DEMO_NOW, planSeriesSince, trackRecordSeries } from "@/lib/demoSeries";
import { iconBtn, Pager } from "./primitives";
import { useChainReady } from "../useChainReady";

const PER_PAGE = 10;
const DAY = 86_400e3;

/** Local calendar-day key ("2026-09-07") for grouping. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "Sep 5" relative to `nowMs`. */
function dayLabel(ms: number, nowMs: number): string {
  const key = dayKey(ms);
  if (key === dayKey(nowMs)) return "Today";
  if (key === dayKey(nowMs - DAY)) return "Yesterday";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function timeOf(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function shortDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
}

interface Group {
  key: string;
  label: string;
  rows: ActivityRow[];
}

/** Group rows by calendar day (order preserved); undated rows trail under "Earlier". */
function groupByDay(rows: ActivityRow[], nowMs: number): Group[] {
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  let earlier: Group | null = null;
  for (const r of rows) {
    if (!r.timestamp) {
      if (!earlier) earlier = { key: "earlier", label: "Earlier", rows: [] };
      earlier.rows.push(r);
      continue;
    }
    const ms = r.timestamp * 1000;
    const key = dayKey(ms);
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: dayLabel(ms, nowMs), rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  if (earlier) groups.push(earlier);
  return groups;
}

export function ActivityScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  const demo = useDemo();
  const { ready } = useChainReady();
  const { data: activity, isLoading } = useActivity(address ?? undefined);
  const { data: record, isLoading: recordLoading } = useVeraRecord();
  const rows = activity ?? [];
  const recents = record?.recentRecommendations ?? [];

  // Track record: $100 following every recorded plan. Only the demo has a series
  // today — the real record has no cost basis yet, so the card is hidden there
  // rather than drawn from nothing.
  const track = useMemo<PricePoint[]>(() => (demo ? trackRecordSeries() : []), [demo]);
  const trackChange = track.length > 1 ? ((track[track.length - 1].v - track[0].v) / track[0].v) * 100 : 0;
  const [hover, setHover] = useState<(PricePoint & { index: number }) | null>(null);
  // "Now" is fixed for the life of the screen (a day label never flips
  // mid-visit); demo timestamps count back from a fixed anchor so "Today" is stable.
  const [nowMs] = useState(() => (demo ? DEMO_NOW : Date.now()));

  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  const groups = groupByDay(pageRows, nowMs);

  const openReceipt = (a: ActivityRow) =>
    go("receipt", {
      title: a.status === "failed" ? "Plan didn't go through" : "Invested in a plan",
      amount: a.usdc,
      txHash: a.txHash,
      at: a.timestamp ? a.timestamp * 1000 : undefined,
      legs: a.legs,
      failed: a.status === "failed",
    });

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>
          Activity
        </h1>
      </div>

      <div style={{ padding: "18px 22px 0" }}>
        {isLoading && rows.length === 0 ? (
          <div className="card" style={{ padding: "4px 16px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "13px 0",
                  borderBottom: i < 2 ? "1px solid var(--line-2)" : "none",
                }}
              >
                <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 11, flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "50%", height: 13, borderRadius: 6 }} />
                  <div className="skeleton" style={{ width: "32%", height: 11, borderRadius: 6, marginTop: 7 }} />
                </div>
                <div className="skeleton" style={{ width: 52, height: 15, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div
            className="card"
            style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Nothing yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              When you place a plan, its signed on-chain receipt will appear here.
            </div>
          </div>
        ) : (
          <Reveal key={safePage} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="label-eyebrow" style={{ marginBottom: 8, paddingLeft: 2 }}>{g.label}</div>
                <div className="card" style={{ padding: "4px 16px" }}>
                  {g.rows.map((a, i) => (
                    <ActivityItem
                      key={a.txHash + i}
                      row={a}
                      last={i === g.rows.length - 1}
                      onClick={() => openReceipt(a)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </Reveal>
        )}
        {rows.length > PER_PAGE && <Pager page={safePage} pageCount={pageCount} onPage={setPage} />}
      </div>

      {/* Vera's track record — what $100 following every recorded plan is worth */}
      {ready && track.length > 1 && (
        <div style={{ padding: "26px 22px 0" }}>
          <SectionTitle>Vera&apos;s track record</SectionTitle>
          <div className="card" style={{ padding: "14px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, minHeight: 22 }}>
              <span style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600 }}>
                {hover ? usd(hover.v) : "$100 following every plan"}
              </span>
              <span
                className="tnum"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  flex: "none",
                  color: hover ? "var(--ink-2)" : trackChange >= 0 ? "var(--pos)" : "var(--neg)",
                }}
              >
                {hover
                  ? new Date(hover.t as number).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : `${fmtPct(trackChange)} · 6M`}
              </span>
            </div>
            <div style={{ marginTop: 10 }}>
              <PriceChart
                points={track}
                up={trackChange >= 0}
                area
                height={120}
                onScrub={setHover}
                formatValue={(v) => usd(v)}
                label={`$100 following every recorded plan, ${trackChange >= 0 ? "up" : "down"} ${Math.abs(trackChange).toFixed(1)}% over six months`}
              />
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "16px 0 0", lineHeight: 1.5 }}>
              Past results don&apos;t promise future ones.
            </p>
          </div>
        </div>
      )}

      {/* Vera's recorded plans — REAL, from the on-chain log, and public: these
          are every plan she has signed, not only yours */}
      {ready && (
        <div style={{ padding: "26px 22px 0" }}>
          <SectionTitle>Vera&apos;s recorded plans</SectionTitle>
          <p style={{ margin: "-4px 0 10px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
            Every plan she has signed, for everyone.
          </p>
          {recordLoading && recents.length === 0 ? (
            <div className="card" style={{ padding: "4px 16px" }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    padding: "13px 0",
                    borderBottom: i < 2 ? "1px solid var(--line-2)" : "none",
                  }}
                >
                  <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 11, flex: "none" }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ width: "55%", height: 13, borderRadius: 6 }} />
                    <div className="skeleton" style={{ width: "35%", height: 11, borderRadius: 6, marginTop: 7 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : recents.length === 0 ? (
            <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>No plans recorded yet</div>
              <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
                Every plan Vera builds is signed and written on-chain. The first one will appear here,
                permanently.
              </div>
            </div>
          ) : (
            <Reveal className="card" style={{ padding: "4px 16px" }}>
              {recents.map((r, i) => {
                const placed = r.usdcSpent !== undefined;
                const risk = riskLabel(r.riskScore);
                const symbols = r.symbols ?? [];
                const spark = symbols.length && r.timestamp ? planSeriesSince(symbols, r.timestamp * 1000) : [];
                const sparkUp = spark.length > 1 ? spark[spark.length - 1] >= spark[0] : true;
                const when = r.timestamp ? shortDate(r.timestamp) : undefined;
                return (
                  <button
                    key={r.txHash + i}
                    className="row"
                    onClick={() =>
                      go("receipt", {
                        title: placed ? "Invested in a plan" : "Plan recommended",
                        amount: placed ? r.usdcSpent : undefined,
                        txHash: r.txHash,
                      })
                    }
                    style={{
                      padding: "13px 0",
                      minHeight: 64,
                      borderBottom: i < recents.length - 1 ? "1px solid var(--line-2)" : "none",
                    }}
                  >
                    {symbols.length > 0 ? (
                      <span style={{ display: "inline-flex", minWidth: 38, flex: "none" }}>
                        <LogoCluster assets={symbols.map((s) => ({ symbol: s }))} size={24} max={3} />
                      </span>
                    ) : (
                      <span
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 11,
                          flex: "none",
                          display: "grid",
                          placeItems: "center",
                          background: "var(--primary-soft)",
                          color: "var(--primary)",
                        }}
                      >
                        <Icon name={placed ? "check" : "shield"} size={18} stroke={2.2} />
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14.5,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {risk.label} plan
                      </div>
                      <div className="tnum" style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
                        {placed
                          ? `${usd(r.usdcSpent as number)} · ${when ? `Placed ${when}` : "Placed on-chain"}`
                          : when
                            ? `Recommended ${when}`
                            : "Recommended on-chain"}
                      </div>
                    </div>
                    {spark.length > 1 && (
                      <Sparkline data={spark} w={60} h={22} color={sparkUp ? "var(--pos)" : "var(--neg)"} />
                    )}
                    {/* the sparkline is the row's affordance; the chevron only fills in without one */}
                    {spark.length < 2 && <Icon name="chevR" size={16} style={{ color: "var(--ink-3)", flex: "none" }} />}
                  </button>
                );
              })}
            </Reveal>
          )}
        </div>
      )}

      <div style={{ padding: "22px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("settings")} />
      </div>
    </div>
  );
}

function ActivityItem({ row: a, last, onClick }: { row: ActivityRow; last: boolean; onClick: () => void }) {
  const pending = a.status === "pending";
  const failed = a.status === "failed";
  const holdings = `${a.legCount} ${a.legCount === 1 ? "holding" : "holdings"}`;
  const symbols = a.symbols ?? [];
  const title = failed ? "Plan didn't go through" : pending ? "Placing a plan" : "Invested in a plan";
  const sub = failed
    ? "Nothing was charged"
    : pending
      ? `On its way · ${holdings}`
      : `${a.timestamp ? `${timeOf(a.timestamp)} · ` : ""}${holdings}`;

  return (
    <button
      className="row"
      onClick={onClick}
      style={{
        padding: "13px 0",
        minHeight: 64,
        borderBottom: last ? "none" : "1px solid var(--line-2)",
      }}
    >
      {/* left: the plan's holdings, or a state tile */}
      {failed ? (
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            flex: "none",
            display: "grid",
            placeItems: "center",
            background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
            color: "var(--neg)",
          }}
        >
          <Icon name="close" size={18} stroke={2.2} />
        </span>
      ) : symbols.length > 0 ? (
        <span style={{ display: "inline-flex", minWidth: 38, flex: "none", opacity: pending ? 0.7 : 1 }}>
          <LogoCluster assets={symbols.map((s) => ({ symbol: s }))} size={24} max={3} />
        </span>
      ) : (
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            flex: "none",
            display: "grid",
            placeItems: "center",
            background: "var(--primary-soft)",
            color: "var(--primary)",
          }}
        >
          <Icon name={pending ? "clock" : "check"} size={18} stroke={2.2} />
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, color: failed ? "var(--ink-2)" : "var(--ink)" }}>{title}</div>
        <div
          className="tnum"
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}
        >
          {pending && (
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--primary)",
                flex: "none",
                animation: "dotPulse 1.1s var(--ease-out) infinite",
              }}
            />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
        </div>
      </div>

      <span
        className="tnum"
        style={{
          fontWeight: 700,
          fontSize: 15,
          flex: "none",
          color: failed ? "var(--ink-3)" : pending ? "var(--ink-2)" : "var(--ink)",
          textDecoration: failed ? "line-through" : "none",
        }}
      >
        {usd(a.usdc)}
      </span>
    </button>
  );
}
