"use client";

// Vera — trust & track record (screens_vera.jsx). Now wired to REAL on-chain data:
// her verifiable identity (agentId 1 in the IdentityRegistry, useAgentIdentity) AND
// her actual track record read from the StaxExecutor event log (useVeraRecord):
// total recommendations, executed volume, and the most recent recorded plans (each
// linking to its real Mantlescan tx). Empty history degrades to an honest 0-state.
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useVeraRecord } from "@/hooks/useVeraRecord";
import { VERA } from "@/lib/veraData";
import { Icon, VeraOrb, SectionTitle, type IconName } from "@/components/design";
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

        {/* verifiable on-chain identity (real) */}
        <a
          href={identity ? addressUrl(identity.registry) : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="tap"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            marginTop: 12,
            background: "var(--accent-soft)",
            borderRadius: 99,
            padding: "7px 13px",
          }}
        >
          <Icon name="shield" size={15} stroke={2} style={{ color: "var(--accent)" }} />
          <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>
            {identity ? `Verified agent #${identity.agentId.toString()}` : VERA.handle}
          </span>
          <Icon name="link" size={13} style={{ color: "var(--accent)" }} />
        </a>
        {identity && (
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 7 }}>
            Identity registry · {shortAddress(identity.registry)}
          </div>
        )}
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
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                      {placed ? "Placed" : "Recommended"} · {shortAddress(r.txHash)}
                    </div>
                  </div>
                  <Icon name="link" size={16} style={{ color: "var(--accent)" }} />
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

      {/* CTA */}
      <div style={{ padding: "22px 22px 0" }}>
        <button className="btn btn-primary btn-block btn-lg tap" onClick={() => go("goal")}>
          <VeraOrb size={24} /> Build a plan with Vera
        </button>
      </div>
    </div>
  );
}
