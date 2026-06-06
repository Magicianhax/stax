"use client";

// Vera — trust & track record (screens_vera.jsx). Now wired to REAL on-chain data:
// her verifiable identity (agentId 1 in the IdentityRegistry, useAgentIdentity) AND
// her actual track record read from the StaxExecutor event log (useVeraRecord):
// total recommendations, executed volume, and the most recent recorded plans (each
// linking to its real Mantlescan tx). Empty history degrades to an honest 0-state.
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useVeraRecord } from "@/hooks/useVeraRecord";
import { VERA } from "@/lib/veraData";
import { Icon, VeraOrb, SectionTitle, Seal, type IconName } from "@/components/design";
import { addressUrl, shortAddress, usd, riskLabel } from "@/lib/format";

export function VeraScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { data: identity } = useAgentIdentity();
  const { data: record, isLoading: recordLoading } = useVeraRecord();

  const totalRecs = record?.totalRecommendations ?? 0;
  const totalUsd = record?.totalExecutedUsd ?? 0;
  const executedCount = record?.executedCount ?? 0;
  const recents = record?.recentRecommendations ?? [];

  const trustPoints: { icon: IconName; t: string; s: string }[] = [
    { icon: "signature", t: "Signed", s: "Every plan is signed by me" },
    { icon: "lock", t: "Recorded", s: "Saved permanently, can't be edited" },
    { icon: "globe", t: "Open", s: "Anyone can check my record" },
  ];

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      {/* hero */}
      <div className="anim-rise" style={{ padding: "20px 22px 0", textAlign: "center" }}>
        <div style={{ display: "inline-block", marginBottom: 14 }}>
          <VeraOrb size={84} pulse />
        </div>
        <h1 className="serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-.01em" }}>
          {VERA.name}
        </h1>
        <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 2 }}>{VERA.role}</div>

        {/* verifiable on-chain identity — a credential lockup (gradient seal +
            brand-serif agent number), not a generic chip */}
        <div style={{ marginTop: 15, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Seal size={23} />
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>Verified agent</span>
            <span className="serif" style={{ fontSize: 19, fontWeight: 600, color: "var(--primary)", lineHeight: 1 }}>
              №{identity ? identity.agentId.toString() : "1"}
            </span>
          </div>
          {identity && (
            <a
              href={addressUrl(identity.registry)}
              target="_blank"
              rel="noopener noreferrer"
              className="tap"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)" }}
            >
              IdentityRegistry <span className="mono">{shortAddress(identity.registry)}</span>
              <Icon name="arrowUR" size={12} />
            </a>
          )}
        </div>
      </div>

      {/* stat band — REAL, from the on-chain executor log */}
      <div className="anim-rise" style={{ animationDelay: ".05s", padding: "22px 22px 0" }}>
        <div className="card" style={{ padding: 18, display: "flex", textAlign: "center" }}>
          <div style={{ flex: 1, borderRight: "1px solid var(--line-2)" }}>
            <div className="tnum" style={{ fontSize: 24, fontWeight: 700 }}>
              {recordLoading ? (
                <span className="skeleton" style={{ display: "inline-block", width: 34, height: 22, borderRadius: 7 }} />
              ) : (
                totalRecs.toLocaleString("en-US")
              )}
            </div>
            <div className="label-eyebrow" style={{ marginTop: 4 }}>
              Plans built
            </div>
          </div>
          <div style={{ flex: 1, borderRight: "1px solid var(--line-2)" }}>
            <div className="tnum" style={{ fontSize: 24, fontWeight: 700, color: "var(--pos)" }}>
              {recordLoading ? (
                <span className="skeleton" style={{ display: "inline-block", width: 56, height: 22, borderRadius: 7 }} />
              ) : (
                usd(totalUsd)
              )}
            </div>
            <div className="label-eyebrow" style={{ marginTop: 4 }}>
              Invested
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="tnum" style={{ fontSize: 24, fontWeight: 700 }}>
              {recordLoading ? (
                <span className="skeleton" style={{ display: "inline-block", width: 30, height: 22, borderRadius: 7 }} />
              ) : (
                executedCount.toLocaleString("en-US")
              )}
            </div>
            <div className="label-eyebrow" style={{ marginTop: 4 }}>
              Placed
            </div>
          </div>
        </div>
      </div>

      {/* primary actions — build a plan, or hand it to Autopilot. Matching cards:
          same structure, Build is primary (green), Autopilot secondary (neutral). */}
      <div className="anim-rise" style={{ animationDelay: ".06s", padding: "20px 22px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        <button
          className="card tap"
          onClick={() => go("goal")}
          style={{ width: "100%", padding: 16, display: "flex", alignItems: "center", gap: 14, textAlign: "left", background: "var(--hero-grad)", color: "var(--primary-ink)", boxShadow: "var(--shadow-lg)" }}
        >
          <span
            style={{ width: 44, height: 44, borderRadius: 13, flex: "none", display: "grid", placeItems: "center", background: "rgba(255,255,255,0.22)" }}
          >
            <VeraOrb size={28} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15.5 }}>Build a plan with Vera</div>
            <div style={{ fontSize: 13, marginTop: 2, lineHeight: 1.45, opacity: 0.85 }}>
              Tell me a goal, I&apos;ll build it in seconds.
            </div>
          </div>
          <Icon name="chevR" size={18} style={{ flex: "none", opacity: 0.85 }} />
        </button>

        <button
          className="card tap"
          onClick={() => go("autopilot")}
          style={{ width: "100%", padding: 16, display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}
        >
          <span
            style={{ width: 44, height: 44, borderRadius: 13, flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <Icon name="spark" size={22} stroke={2} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15.5 }}>Autopilot</div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.45 }}>
              Let me invest for you on a schedule, within limits you set.
            </div>
          </div>
          <Icon name="chevR" size={18} style={{ color: "var(--ink-3)", flex: "none" }} />
        </button>
      </div>

      {/* why trust me */}
      <div style={{ padding: "20px 22px 0" }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <VeraOrb size={32} />
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--ink)" }}>
              &ldquo;{VERA.blurb}&rdquo;
            </p>
          </div>
          {/* Trust points — a clean row list (consistent with Settings/Activity
              rows), not three identical nested cards. */}
          <div style={{ marginTop: 14 }}>
            {trustPoints.map((x) => (
              <div
                key={x.t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "11px 0",
                  borderTop: "1px solid var(--line-2)",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                >
                  <Icon name={x.icon} size={17} stroke={2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: "-.01em" }}>{x.t}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>{x.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* recorded recommendations — REAL, from the on-chain log */}
      <div style={{ padding: "22px 22px 0" }}>
        <SectionTitle>Recorded recommendations</SectionTitle>
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
          <div
            className="card"
            style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
              No plans recorded yet
            </div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              Every plan Vera builds is signed and written on-chain. The first one will appear here,
              permanently.
            </div>
          </div>
        ) : (
          <div className="card stagger-in" style={{ padding: "4px 16px" }}>
            {recents.map((r, i) => {
              const placed = r.usdcSpent !== undefined;
              const risk = riskLabel(r.riskScore);
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
                    borderBottom: i < recents.length - 1 ? "1px solid var(--line-2)" : "none",
                  }}
                >
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
                      {risk.label} plan{placed ? ` · ${usd(r.usdcSpent as number)}` : ""}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                      {placed ? "Placed on-chain" : "Recommended on-chain"}
                    </div>
                  </div>
                  <Icon name="chevR" size={16} style={{ color: "var(--ink-3)" }} />
                </button>
              );
            })}
          </div>
        )}
        <p
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            textAlign: "center",
            padding: "14px 30px 0",
            lineHeight: 1.5,
          }}
        >
          Every plan is signed and recorded on-chain, so this record can&apos;t be edited after the
          fact. Past results don&apos;t promise future ones.
        </p>
      </div>

    </div>
  );
}
