"use client";

// Autopilot — Vera invests for you on a schedule, autonomously, within bounds you
// authorize. You delegate your embedded wallet once (Privy session signer), set a
// recurring plan (amount · cadence · risk ceiling), and a server job runs it. The
// delegation is revocable any time, and every run is gated by hard limits.
import { useEffect, useState } from "react";
import { useDelegatedActions, usePrivy } from "@privy-io/react-auth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useToast, Icon } from "@/components/design";
import { authHeader } from "@/lib/authedFetch";
import { CADENCE_LABEL, type Cadence, type AutopilotConfig } from "@/lib/autopilot";
import { usd } from "@/lib/format";
import { STAX_FEE_LABEL } from "@/lib/fees";
import { haptic } from "@/lib/haptics";
import { iconBtn, Spinner } from "./primitives";

const CADENCES: Cadence[] = ["daily", "weekly", "biweekly", "monthly"];
const RISK_TIERS: { label: string; bps: number }[] = [
  { label: "Careful", bps: 4000 },
  { label: "Balanced", bps: 6000 },
  { label: "Bolder", bps: 8000 },
];

export function AutopilotScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { user } = usePrivy();
  const { address: smartAccount } = useSmartAccount();
  const { delegateWallet, revokeWallets } = useDelegatedActions();
  const { notify } = useToast();

  // The embedded wallet linked account carries the `delegated` flag + the server
  // `id` (walletId) that the backend signs with. (ConnectedWallet from useWallets
  // does NOT — those fields live on the linked account.)
  type EmbeddedAcct = { type: "wallet"; address: string; walletClientType?: string; delegated?: boolean; id?: string | null };
  const embedded = user?.linkedAccounts?.find(
    (a) => a.type === "wallet" && (a as EmbeddedAcct).walletClientType === "privy",
  ) as EmbeddedAcct | undefined;
  const ownerAddress = embedded?.address;
  const delegated = Boolean(embedded?.delegated);
  const walletId = embedded?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state.
  const [goal, setGoal] = useState("Grow my long-term plan");
  const [amount, setAmount] = useState("25");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [risk, setRisk] = useState(1); // index into RISK_TIERS

  // Load the current autopilot (if any).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/autopilot", { headers: { ...(await authHeader()) } });
        const json = await res.json();
        if (cancelled) return;
        const ap = json?.autopilot as AutopilotConfig | null;
        if (ap) {
          setConfig(ap);
          setGoal(ap.goal);
          setAmount(String(ap.amountUsd));
          setCadence(ap.cadence);
          setRisk(Math.max(0, RISK_TIERS.findIndex((t) => t.bps === ap.riskCeilingBps)) || 1);
        }
      } catch {
        /* leave defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const amountNum = Number(amount) || 0;
  const active = Boolean(config?.active);

  const authorize = async () => {
    if (!ownerAddress) return;
    setBusy(true);
    try {
      await delegateWallet({ address: ownerAddress, chainType: "ethereum" });
      haptic.success();
      notify("Vera is authorized", "check");
    } catch {
      notify("Authorization was declined", "info");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!walletId || !ownerAddress || !smartAccount) {
      notify("Authorize Vera first", "info");
      return;
    }
    if (amountNum <= 0) {
      notify("Set an amount", "info");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          walletId,
          owner: ownerAddress,
          smartAccount,
          goal,
          amountUsd: amountNum,
          cadence,
          riskCeilingBps: RISK_TIERS[risk].bps,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Couldn't save autopilot.");
      setConfig(json.autopilot as AutopilotConfig);
      haptic.success();
      notify("Autopilot is on", "check");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't save autopilot.", "info");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await fetch("/api/autopilot", { method: "DELETE", headers: { ...(await authHeader()) } });
      try {
        await revokeWallets();
      } catch {
        /* revoking the delegation is best-effort */
      }
      setConfig(null);
      haptic.medium();
      notify("Autopilot is off", "check");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Autopilot</h1>
      </div>

      <div className="anim-rise" style={{ padding: "8px 22px 0" }}>
        <p style={{ margin: 0, fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5 }}>
          Let Vera invest for you on a schedule, automatically and gasless, within limits you set.
          She can never spend more, or take more risk, than you authorize.
        </p>
      </div>

      {loading ? (
        <div style={{ padding: "40px", display: "grid", placeItems: "center" }}><Spinner /></div>
      ) : (
        <>
          {/* status pill when active */}
          {active && config && (
            <div className="anim-rise" style={{ padding: "16px 22px 0" }}>
              <div className="card" style={{ padding: 16, background: "var(--accent-soft)", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 36, height: 36, borderRadius: 11, background: "var(--primary)", color: "var(--primary-ink)", display: "grid", placeItems: "center", flex: "none" }}>
                  <Icon name="check" size={19} stroke={2.4} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>On · {usd(config.amountUsd)} {CADENCE_LABEL[config.cadence].toLowerCase()}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                    Next run {new Date(config.nextRunAt * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {config.runs} run{config.runs === 1 ? "" : "s"} so far
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* authorization status */}
          <div style={{ padding: "18px 22px 0" }}>
            <div className="label-eyebrow" style={{ marginBottom: 8 }}>Authorization</div>
            <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <Icon name={delegated ? "shield" : "lock"} size={20} style={{ color: delegated ? "var(--primary)" : "var(--ink-3)", flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{delegated ? "Vera is authorized" : "Authorize Vera"}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                  {delegated ? "Bounded, gasless, revocable any time." : "A one-time grant so Vera can place your scheduled plans."}
                </div>
              </div>
              {!delegated && (
                <button className="btn btn-primary tap" disabled={busy} onClick={authorize} style={{ height: 38, padding: "0 14px", flex: "none" }}>
                  {busy ? <Spinner small /> : "Authorize"}
                </button>
              )}
            </div>
          </div>

          {/* config form */}
          <div style={{ padding: "20px 22px 0" }}>
            <div className="label-eyebrow" style={{ marginBottom: 8 }}>Your plan</div>
            <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Goal</span>
                <input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  maxLength={120}
                  style={{ width: "100%", marginTop: 6, padding: "11px 12px", borderRadius: 12, border: "none", background: "var(--surface-2)", outline: "none", fontSize: 14.5, color: "var(--ink)" }}
                />
              </label>

              <div>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Amount each run</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "8px 12px", borderRadius: 12, background: "var(--surface-2)" }}>
                  <span className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>$</span>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="tnum"
                    style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 20, fontWeight: 700, color: "var(--ink)" }}
                  />
                </div>
              </div>

              <div>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>How often</span>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {CADENCES.map((c) => (
                    <button key={c} onClick={() => setCadence(c)} className={`chip tap ${cadence === c ? "is-dark" : ""}`} style={{ height: 36, flex: "1 1 auto" }}>
                      {CADENCE_LABEL[c].replace("Every ", "")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Risk ceiling Vera won&apos;t cross</span>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {RISK_TIERS.map((t, i) => (
                    <button key={t.label} onClick={() => setRisk(i)} className={`chip tap ${risk === i ? "is-dark" : ""}`} style={{ height: 36, flex: 1, justifyContent: "center" }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>
              Each run deploys {usd(amountNum)} ({STAX_FEE_LABEL} fee, gas on us) only if your balance covers it and Vera&apos;s
              risk stays at or under your ceiling. Capped at {usd(amountNum * 2)} per period.
            </div>
          </div>

          {/* actions */}
          <div style={{ padding: "22px 22px 0" }}>
            {!active ? (
              <button className="btn btn-primary btn-block btn-lg tap" disabled={busy || !delegated} style={{ opacity: delegated ? 1 : 0.5 }} onClick={save}>
                {busy ? <Spinner small /> : delegated ? "Start autopilot" : "Authorize Vera first"}
              </button>
            ) : (
              <button className="btn btn-ghost btn-block btn-lg tap" disabled={busy} style={{ color: "var(--neg)" }} onClick={stop}>
                {busy ? <Spinner small /> : "Turn off autopilot"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
