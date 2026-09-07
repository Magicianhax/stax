"use client";

// Autopilot — Vera invests for you on a schedule, autonomously, within bounds you
// authorize. You delegate your embedded wallet once (Privy session signer), set a
// recurring plan (amount · cadence · risk ceiling), and a server job runs it. The
// delegation is revocable any time, and every run is gated by hard limits.
//
// Two targets: a plain-language GOAL (Vera re-allocates each run) or a BASKET (fixed
// weights, no Vera call; the basket's own risk must sit under the ceiling or every run
// would be refused — the form says so before you start).
import { useEffect, useState, useCallback } from "react";
import { useSessionSigners, usePrivy } from "@privy-io/react-auth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useUsdcBalance } from "@/hooks/useBalances";
import { useToast, Icon, Seal, BottomSheet, ChainLaunching, ChainMark, LogoCluster, ProjectionChart } from "@/components/design";
import { Reveal } from "@/components/motion";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { useDemo } from "@/components/demo/DemoProvider";
import { displayFor } from "@/lib/displayAssets";
import { authedFetch } from "@/lib/authedFetch";
import {
  CADENCE_LABEL,
  checkBasketCeiling,
  nextRunAfter,
  type AutopilotBasketSummary,
  type Cadence,
  type AutopilotConfig,
} from "@/lib/autopilot";
import { riskWord, type Basket } from "@/lib/baskets";
import { useBaskets } from "@/hooks/useBaskets";
import { BasketRailTile, clusterOf } from "./basketPrimitives";
import { getChain, explorerTx, type ChainKey } from "@/lib/chains";
import { useChainKey } from "@/lib/chains/active";
import { DEMO_NOW, projection } from "@/lib/demoSeries";
import { usd } from "@/lib/format";
import { feeUsd } from "@/lib/fees";
import { haptic } from "@/lib/haptics";
import { iconBtn, Spinner, sectionLabel } from "./primitives";
import { useChainReady } from "../useChainReady";

const CADENCES: Cadence[] = ["daily", "weekly", "biweekly", "monthly"];
// "$25/week", "$25 every 2 weeks" — the per-run phrasing for previews.
const PER_RUN: Record<Cadence, string> = { daily: "/day", weekly: "/week", biweekly: " every 2 weeks", monthly: "/month" };
const PROJECTION_MONTHS = 12;

const wholeUsd = (v: number) => usd(v).replace(/\.00$/, "");
/** "Mon 14 Sep" — weekday, day, month; no year, no time. */
function shortDay(ms: number): string {
  const d = new Date(ms);
  const wd = d.toLocaleDateString("en-US", { weekday: "short" });
  const mon = d.toLocaleDateString("en-US", { month: "short" });
  return `${wd} ${d.getDate()} ${mon}`;
}

/** Projection chart + its one-line reading, live from amount · cadence · risk. */
function Projection({ amount, cadence, riskBps }: { amount: number; cadence: Cadence; riskBps: number }) {
  const { contributed, projected } = projection({ amount, cadence, riskBps, months: PROJECTION_MONTHS });
  const end = projected[projected.length - 1]?.v ?? 0;
  return (
    <div className="card" style={{ padding: "16px 16px 14px" }}>
      <ProjectionChart contributed={contributed} projected={projected} height={132} />
      <div aria-live="polite" style={{ marginTop: 12, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.45 }}>
        {amount > 0 ? (
          <>
            ≈ <b className="tnum" style={{ color: "var(--ink)" }}>{wholeUsd(Math.round(end))}</b> in {PROJECTION_MONTHS} months at{" "}
            <b className="tnum" style={{ color: "var(--ink)" }}>{wholeUsd(amount)}{PER_RUN[cadence]}</b>. A guide, not a promise.
          </>
        ) : (
          "Set an amount to see where it could go."
        )}
      </div>
    </div>
  );
}
const RISK_TIERS: { label: string; bps: number }[] = [
  { label: "Careful", bps: 4000 },
  { label: "Balanced", bps: 6000 },
  { label: "Bolder", bps: 8000 },
];

// The server's key-quorum / signer id (Privy dashboard → Wallet API signers).
// Granting it as a session signer lets the backend sign for the user's TEE wallet.
const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

type Mode = "goal" | "basket";

// Quick-start presets — tap one to fill the plan below. risk = index into RISK_TIERS.
// `basket` = a curated slug: the template switches to Basket mode and selects it.
const TEMPLATES: { name: string; goal: string; amount: string; cadence: Cadence; risk: number; basket?: string }[] = [
  { name: "Steady saver", goal: "Grow my long-term plan", amount: "25", cadence: "weekly", risk: 1 },
  { name: "Play it safe", goal: "Safe, steady growth", amount: "20", cadence: "weekly", risk: 0 },
  { name: "Big Tech basket", goal: "Invest in Big Tech", amount: "50", cadence: "weekly", risk: 2, basket: "big-tech" },
  { name: "Daily dollars", goal: "A little into the market each day", amount: "5", cadence: "daily", risk: 1 },
];

/** What the form needs from a picked basket — a local Basket, or the summary the API returned. */
type BasketPick = Pick<Basket, "id" | "name" | "items" | "riskScore">;

/** The short id minted by `publish()` — its URL is `/app?b=<id>`. */
function shortIdFromUrl(url: string): string | null {
  try {
    return new URL(url, "https://stax.local").searchParams.get("b");
  } catch {
    return null;
  }
}

type RunRow = {
  ranAt: number;
  amountUsd: number;
  assessedRiskBps?: number;
  status: "success" | "skipped" | "error";
  reason?: string;
  txHash?: string;
  holdings?: { symbol: string; weightPct: number; amountUsd: number }[];
  /** Network the run was placed on (older rows may lack it → the config's chain). */
  chain?: ChainKey;
  /** Set when the run targeted a basket (bought it, or refused it). */
  basketId?: string;
  basketName?: string;
};

export function AutopilotScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { user } = usePrivy();
  const { address: smartAccount } = useSmartAccount();
  const { chain, ready } = useChainReady();
  const [, setChainKey] = useChainKey();
  const { data: bal } = useUsdcBalance(smartAccount ?? undefined);
  const cash = bal?.value ?? 0;
  const { addSessionSigners, removeSessionSigners } = useSessionSigners();
  const { notify } = useToast();
  // Demo previews anchor to the fixed demo clock so screenshots are stable.
  // Read once on mount; the preview only needs a "from now" that doesn't drift
  // between keystrokes.
  const demo = useDemo();
  const [now] = useState(() => (demo ? DEMO_NOW : Date.now()));

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

  // Baskets the user can point the autopilot at: theirs (localStorage) + Made by Stax.
  const { mine: myBaskets, curated: curatedBaskets, byId, publish } = useBaskets();
  // The basket the ACTIVE autopilot targets, as the API resolved it (may not be in localStorage).
  const [apBasket, setApBasket] = useState<AutopilotBasketSummary | null>(null);

  // Form state.
  const [mode, setMode] = useState<Mode>("goal");
  const [basketId, setBasketId] = useState<string | null>(null);
  const [goal, setGoal] = useState("Grow my long-term plan");
  const [amount, setAmount] = useState("25");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [risk, setRisk] = useState(1); // index into RISK_TIERS
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runPage, setRunPage] = useState(0);
  const [detailRun, setDetailRun] = useState<RunRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Load the current autopilot (if any).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch("/api/autopilot");
        const json = await res.json();
        if (cancelled) return;
        const ap = json?.autopilot as AutopilotConfig | null;
        const summary = (json?.basket ?? null) as AutopilotBasketSummary | null;
        if (ap) {
          setConfig(ap);
          setGoal(ap.goal);
          setAmount(String(ap.amountUsd));
          setCadence(ap.cadence);
          setRisk(Math.max(0, RISK_TIERS.findIndex((t) => t.bps === ap.riskCeilingBps)) || 1);
          setApBasket(summary);
          if (ap.basketId) {
            setMode("basket");
            setBasketId(ap.basketId);
          }
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
  const riskBps = RISK_TIERS[risk].bps;
  // The picked basket: a local one by id, else the API's summary of the saved target.
  const pick: BasketPick | undefined = byId(basketId ?? undefined) ?? (apBasket && apBasket.id === basketId ? apBasket : undefined);
  const basketMode = mode === "basket";
  // Fixed weights = known risk: refuse up front instead of letting every run be skipped.
  const ceiling = basketMode && pick ? checkBasketCeiling(pick.riskScore, riskBps) : { ok: true };
  const basketBlocked = basketMode && (!pick || !ceiling.ok);
  // Projection follows what will actually be bought: the basket's risk, else the ceiling.
  const projectionBps = basketMode && pick ? pick.riskScore : riskBps;
  const nextRun = nextRunAfter(Math.floor(now / 1000), cadence) * 1000;
  const active = Boolean(config?.active);
  // The autopilot runs on the network it was saved on, not the one the UI is
  // showing. Receipts link to that chain's explorer.
  // Five at a time. The whole history in one column pushed everything below it
  // off the screen, and nobody scrolls a hundred identical skipped runs.
  const RUNS_PER_PAGE = 5;
  const runPages = Math.max(1, Math.ceil(runs.length / RUNS_PER_PAGE));
  const page = Math.min(runPage, runPages - 1);
  const pageRuns = runs.slice(page * RUNS_PER_PAGE, page * RUNS_PER_PAGE + RUNS_PER_PAGE);

  const apChain = getChain(config?.chain ?? chain.key);
  const elsewhere = active && apChain.key !== chain.key;

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setMode(t.basket ? "basket" : "goal");
    setBasketId(t.basket ? `${chain.key}:${t.basket}` : null);
    setGoal(t.goal);
    setAmount(t.amount);
    setCadence(t.cadence);
    setRisk(t.risk);
    setActiveTemplate(t.name);
    haptic.light();
  };

  // Load Vera's run history (audit trail) when an autopilot is active.
  const loadRuns = useCallback(async () => {
    try {
      const r = await authedFetch("/api/autopilot/runs");
      const j = await r.json();
      if (Array.isArray(j?.runs)) setRuns(j.runs as RunRow[]);
    } catch {
      /* activity is best-effort */
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await authedFetch("/api/autopilot/runs");
        const j = await r.json();
        if (!cancelled && Array.isArray(j?.runs)) {
          setRuns(j.runs as RunRow[]);
          setRunPage(0);
        }
      } catch {
        /* activity is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // The history is per network, so switching chains asks for a different list.
  }, [active, chain.key]);

  const authorize = async () => {
    if (!ownerAddress) return;
    if (!PRIVY_SIGNER_ID) {
      notify("Signer not configured (NEXT_PUBLIC_PRIVY_SIGNER_ID)", "info");
      return;
    }
    setBusy(true);
    try {
      // TEE wallets: grant the server's signer as a session signer (not on-device
      // delegation). The backend then signs UserOps for this wallet.
      await addSessionSigners({ address: ownerAddress, signers: [{ signerId: PRIVY_SIGNER_ID }] });
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
    if (basketMode && !pick) {
      notify("Pick a basket", "info");
      return;
    }
    if (basketMode && !ceiling.ok) {
      notify("Raise the ceiling or pick a steadier basket", "info");
      return;
    }
    setBusy(true);
    try {
      // The server only knows curated ids and stored short ids. A personal basket
      // (localStorage) is published first so the cron can load it by id.
      let targetId: string | null = null;
      if (basketMode && pick) {
        const local = byId(pick.id);
        const curated = local?.author === "stax" || pick.id.startsWith(`${chain.key}:`);
        if (curated || apBasket?.id === pick.id) targetId = pick.id;
        else if (local) {
          const url = await publish(local);
          targetId = url ? shortIdFromUrl(url) : null;
          if (!targetId) throw new Error("Couldn't save your basket for autopilot. Try again.");
        } else throw new Error("That basket isn't available anymore.");
      }
      const res = await authedFetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chain: chain.key,
          walletId,
          owner: ownerAddress,
          smartAccount,
          goal: basketMode && pick ? `Invest in ${pick.name}` : goal,
          basketId: targetId,
          amountUsd: amountNum,
          cadence,
          riskCeilingBps: RISK_TIERS[risk].bps,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Couldn't save autopilot.");
      setConfig(json.autopilot as AutopilotConfig);
      const savedBasket = (json.basket ?? null) as AutopilotBasketSummary | null;
      setApBasket(savedBasket);
      if (savedBasket) setBasketId(savedBasket.id);
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
      await authedFetch("/api/autopilot", { method: "DELETE" });
      try {
        if (ownerAddress) await removeSessionSigners({ address: ownerAddress });
      } catch {
        /* revoking the session signer is best-effort */
      }
      setConfig(null);
      setApBasket(null);
      haptic.medium();
      notify("Autopilot is off", "check");
    } finally {
      setBusy(false);
    }
  };

  // Trigger one autonomous run immediately (Vera re-allocates, signs, and places
  // it server-side — no user signature). Same bounds gate as the scheduled cron.
  const runNow = async () => {
    setBusy(true);
    try {
      const res = await authedFetch("/api/autopilot/run", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        notify(json?.reason ?? json?.error ?? "The run didn't go through.", "info");
      } else {
        haptic.success();
        notify("Vera invested for you", "check");
        try {
          const r = await authedFetch("/api/autopilot");
          const j = await r.json();
          if (j?.autopilot) setConfig(j.autopilot as AutopilotConfig);
        } catch {
          /* status refresh is best-effort */
        }
        void loadRuns();
      }
    } catch {
      notify("The run didn't go through.", "info");
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

      {!ready ? (
        <div className="anim-rise" style={{ padding: "18px 22px 0" }}>
          <ChainLaunching
            chain={chain}
            action={
              <button className="btn btn-ghost btn-block tap" onClick={() => go("market")}>
                Browse the market
              </button>
            }
          />
        </div>
      ) : loading ? (
        // Content is loading (not an action) → skeleton, like every other list.
        <div style={{ padding: "18px 22px 0" }}>
          <div className="skeleton" style={{ width: 96, height: 13, borderRadius: 6, marginBottom: 10 }} />
          <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%", flex: "none" }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: "58%", height: 14, borderRadius: 6 }} />
              <div className="skeleton" style={{ width: "40%", height: 11, borderRadius: 6, marginTop: 8 }} />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ACTIVE: status + plan summary + run history (the dashboard) */}
          {active && config && (
            <>
              {elsewhere && (
                <div style={{ padding: "14px 22px 0" }}>
                  <div
                    role="status"
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: "var(--surface-2)", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.4 }}
                  >
                    <ChainMark chain={apChain} size={18} />
                    <span style={{ flex: 1, minWidth: 0 }}>This autopilot runs on {apChain.name}.</span>
                    <button
                      className="tap"
                      onClick={() => {
                        haptic.select();
                        setChainKey(apChain.key);
                        notify(`Switched to ${apChain.name}`, "check");
                      }}
                      style={{ flex: "none", minHeight: 36, padding: "0 10px", borderRadius: 10, fontWeight: 700, color: "var(--primary)" }}
                    >
                      Switch to {apChain.name}
                    </button>
                  </div>
                </div>
              )}
              <div className="anim-rise" style={{ padding: "16px 22px 0" }}>
                <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                  <Seal size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>On · {usd(config.amountUsd)} {CADENCE_LABEL[config.cadence].toLowerCase()}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                      Next run {new Date(config.nextRunAt * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {config.runs} run{config.runs === 1 ? "" : "s"} so far
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ padding: "20px 22px 0" }}>
                <div style={sectionLabel}>Your plan</div>
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontWeight: 700, fontSize: 16.5, textAlign: "center", letterSpacing: "-.01em" }}>{config.goal}</div>
                  {apBasket && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                      <LogoCluster assets={clusterOf(apBasket)} size={20} max={4} />
                      <span>{apBasket.name} · {riskWord(apBasket.riskScore)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", marginTop: 16, textAlign: "center" }}>
                    <div style={{ flex: 1, borderRight: "1px solid var(--line-2)" }}>
                      <div className="tnum" style={{ fontWeight: 700, fontSize: 17 }}>{usd(config.amountUsd)}</div>
                      <div className="label-eyebrow" style={{ marginTop: 4 }}>Each run</div>
                    </div>
                    <div style={{ flex: 1, borderRight: "1px solid var(--line-2)", textTransform: "capitalize" }}>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>{CADENCE_LABEL[config.cadence].replace("Every ", "").trim()}</div>
                      <div className="label-eyebrow" style={{ marginTop: 4 }}>Cadence</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="tnum" style={{ fontWeight: 700, fontSize: 17 }}>≤{Math.round(config.riskCeilingBps / 100)}%</div>
                      <div className="label-eyebrow" style={{ marginTop: 4 }}>Risk</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "center", marginTop: 16, paddingTop: 13, borderTop: "1px solid var(--line-2)", fontSize: 13, fontWeight: 600, color: cash + 1e-6 >= config.amountUsd ? "var(--ink-2)" : "var(--neg)" }}>
                    {usd(cash)} available{cash + 1e-6 < config.amountUsd ? " · add cash to keep running" : ""}
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Projection amount={config.amountUsd} cadence={config.cadence} riskBps={apBasket?.riskScore ?? config.riskCeilingBps} />
                </div>
              </div>

              <div style={{ padding: "20px 22px 0" }}>
                <div style={sectionLabel}>Activity</div>
                {runs.length === 0 ? (
                  <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)", fontSize: 13.5, lineHeight: 1.5 }}>
                    No runs yet. Vera’s actions will appear here, each one tappable.
                  </div>
                ) : (
                  <div className="card" style={{ padding: "4px 16px" }}>
                    {pageRuns.map((r, i) => {
                      const okRun = r.status === "success";
                      const skipped = r.status === "skipped";
                      const when = new Date(r.ranAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                      const bought = (r.holdings ?? []).map((h) => displayFor(h.symbol).name);
                      // A basket run shows the basket (name + logos) instead of listing what it bought.
                      const runBasket = r.basketId ? (byId(r.basketId) ?? (apBasket?.id === r.basketId ? apBasket : undefined)) : undefined;
                      const basketItems = runBasket?.items ?? (r.basketId && r.holdings?.length ? r.holdings : undefined);
                      const basketName = r.basketName ?? runBasket?.name;
                      const sub = okRun
                        ? basketName
                          ? basketName
                          : bought.length
                            ? `${bought.slice(0, 2).join(", ")}${bought.length > 2 ? ` +${bought.length - 2}` : ""}`
                            : `${Math.round((r.assessedRiskBps ?? 0) / 100)}% risk`
                        : [basketName, r.reason].filter(Boolean).join(" · ");
                      return (
                        <button
                          key={`${r.ranAt}-${i}`}
                          onClick={() => setDetailRun(r)}
                          className="row tap"
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", textAlign: "left", borderBottom: i < pageRuns.length - 1 ? "1px solid var(--line-2)" : "none" }}
                        >
                          <span
                            style={{ width: 32, height: 32, borderRadius: 10, flex: "none", display: "grid", placeItems: "center", background: okRun ? "var(--primary-soft)" : skipped ? "var(--surface-2)" : "color-mix(in srgb, var(--neg) 16%, transparent)", color: okRun ? "var(--primary)" : skipped ? "var(--ink-3)" : "var(--neg)" }}
                          >
                            <Icon name={okRun ? "check" : skipped ? "clock" : "info"} size={16} stroke={2.2} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>
                              {okRun ? `Invested ${usd(r.amountUsd)}` : skipped ? "Skipped this run" : "Run didn't go through"}
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {when}
                              {sub ? ` · ${sub}` : ""}
                            </div>
                          </div>
                          {basketItems && basketItems.length > 0 && (
                            <LogoCluster assets={clusterOf({ items: basketItems })} size={20} max={3} showRest={false} />
                          )}
                          <Icon name="chevR" size={16} style={{ color: "var(--ink-3)", flex: "none" }} />
                        </button>
                      );
                    })}
                  </div>
                )}
                {runPages > 1 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 14,
                      marginTop: 10,
                    }}
                  >
                    <button
                      className="btn btn-glass tap"
                      onClick={() => {
                        haptic.light();
                        setRunPage(Math.max(0, page - 1));
                      }}
                      disabled={page === 0}
                      aria-label="Newer runs"
                      style={{ width: 38, height: 34, padding: 0, opacity: page === 0 ? 0.4 : 1 }}
                    >
                      <Icon name="chevL" size={16} />
                    </button>
                    <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600 }}>
                      {page + 1} of {runPages}
                    </span>
                    <button
                      className="btn btn-glass tap"
                      onClick={() => {
                        haptic.light();
                        setRunPage(Math.min(runPages - 1, page + 1));
                      }}
                      disabled={page >= runPages - 1}
                      aria-label="Older runs"
                      style={{ width: 38, height: 34, padding: 0, opacity: page >= runPages - 1 ? 0.4 : 1 }}
                    >
                      <Icon name="chevR" size={16} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* SETUP: authorize + template + plan + start (only when not running) */}
          {!active && (
          <>
          <div style={{ padding: "18px 22px 0" }}>
            <div style={sectionLabel}>Authorization</div>
            {/* Status only. The one CTA at the bottom authorizes first, then starts. */}
            <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 36, height: 36, borderRadius: 99, flex: "none", display: "grid", placeItems: "center", background: delegated ? "var(--primary-soft)" : "var(--surface-2)", color: delegated ? "var(--primary)" : "var(--ink-3)" }}>
                <Icon name={delegated ? "shield" : "lock"} size={19} stroke={2} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{delegated ? "Vera is authorized" : "Not yet authorized"}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                  {delegated ? "Bounded, gasless, revocable any time." : "A one-time grant lets Vera place your scheduled plans. Revocable any time."}
                </div>
              </div>
            </div>
          </div>

          {/* quick-start templates — tap to fill the plan below */}
          <div style={{ padding: "20px 22px 0" }}>
            <div style={sectionLabel}>Start from a template</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {TEMPLATES.map((t) => {
                const on = activeTemplate === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => applyTemplate(t)}
                    className="card tap"
                    style={{ textAlign: "center", padding: "13px", ...(on ? { boxShadow: "var(--glass-shadow), var(--glass-hi), inset 0 0 0 1.5px var(--primary)" } : {}) }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 3 }}>
                      {usd(Number(t.amount))} · {CADENCE_LABEL[t.cadence].replace("Every ", "")} · {RISK_TIERS[t.risk].label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* config form */}
          <div style={{ padding: "20px 22px 0" }}>
            <div style={sectionLabel}>Your plan</div>
            <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* what each run buys: Vera's take on a goal, or a basket's fixed weights */}
              <div className="seg" role="group" aria-label="What to invest in">
                <span
                  className="seg-thumb"
                  style={{ width: "calc((100% - 8px) / 2)", left: 4, transform: `translateX(${basketMode ? "100%" : "0"})` }}
                />
                {(["goal", "basket"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { haptic.select(); setMode(m); setActiveTemplate(null); }}
                    className={`seg-item ${mode === m ? "is-on" : ""}`}
                    aria-pressed={mode === m}
                  >
                    {m === "goal" ? "Goal" : "Basket"}
                  </button>
                ))}
              </div>

              {basketMode ? (
                <div>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Basket to buy each run</span>
                  {/* rail bleeds to the card edges so tiles can scroll under the padding */}
                  <div style={{ display: "flex", gap: 10, margin: "6px -16px -4px", padding: "2px 16px 6px", overflowX: "auto", scrollSnapType: "x proximity" }}>
                    {myBaskets.map((b) => (
                      <BasketRailTile key={b.id} basket={b} selected={basketId === b.id} onClick={() => { haptic.select(); setBasketId(b.id); setActiveTemplate(null); }} />
                    ))}
                    {myBaskets.length > 0 && curatedBaskets.length > 0 && (
                      <span aria-hidden style={{ flex: "none", width: 1, alignSelf: "stretch", margin: "6px 2px", background: "var(--line-2)" }} />
                    )}
                    {curatedBaskets.map((b) => (
                      <BasketRailTile key={b.id} basket={b} selected={basketId === b.id} onClick={() => { haptic.select(); setBasketId(b.id); setActiveTemplate(null); }} />
                    ))}
                    <span aria-hidden style={{ flex: "none", width: 6 }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>
                    {myBaskets.length > 0 ? "Yours first, then made by Stax." : "Made by Stax. Save a plan from Vera to see yours here."}
                  </div>
                </div>
              ) : (
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Goal</span>
                  <input
                    value={goal}
                    onChange={(e) => { setGoal(e.target.value); setActiveTemplate(null); }}
                    maxLength={120}
                    style={{ width: "100%", marginTop: 6, padding: "11px 12px", borderRadius: 12, border: "none", background: "var(--surface-2)", outline: "none", fontSize: 14.5, color: "var(--ink)" }}
                  />
                </label>
              )}

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Amount each run</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: cash + 1e-6 >= amountNum ? "var(--ink-3)" : "var(--neg)" }}>
                    {usd(cash)} available
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "8px 12px", borderRadius: 12, background: "var(--surface-2)" }}>
                  <span className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>$</span>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setActiveTemplate(null); }}
                    className="tnum"
                    style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 20, fontWeight: 700, color: "var(--ink)" }}
                  />
                </div>
              </div>

              <div>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>How often</span>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {CADENCES.map((c) => (
                    <button key={c} onClick={() => { setCadence(c); setActiveTemplate(null); }} className={`chip tap ${cadence === c ? "is-dark" : ""}`} style={{ height: 36, flex: "1 1 auto" }}>
                      {CADENCE_LABEL[c].replace("Every ", "")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Risk ceiling Vera won’t cross</span>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {RISK_TIERS.map((t, i) => (
                    <button key={t.label} onClick={() => { setRisk(i); setActiveTemplate(null); }} className={`chip tap ${risk === i ? "is-dark" : ""}`} style={{ height: 36, flex: 1, justifyContent: "center" }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                {basketMode && pick && (
                  <div aria-live="polite" style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.45, color: ceiling.ok ? "var(--ink-2)" : "var(--neg)" }}>
                    <span style={{ fontWeight: 600, color: ceiling.ok ? "var(--ink)" : "var(--neg)" }}>
                      {pick.name} is {riskWord(pick.riskScore)}
                    </span>
                    {" · "}ceiling {RISK_TIERS[risk].label}
                    {!ceiling.ok && <div style={{ marginTop: 2 }}>Vera would refuse every run. Raise the ceiling or pick a steadier basket.</div>}
                  </div>
                )}
              </div>
            </div>
            {/* preview: what the first run will look like */}
            <div
              aria-live="polite"
              style={{ display: "flex", alignItems: "center", gap: 9, margin: "10px 2px 0", fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}
            >
              <Icon name="clock" size={16} stroke={2} style={{ color: "var(--primary)", flex: "none" }} />
              <span className="tnum">
                Next run {shortDay(nextRun)} · {wholeUsd(amountNum)} · {basketMode ? (pick?.name ?? "pick a basket") : RISK_TIERS[risk].label}
              </span>
            </div>

            <Reveal style={{ marginTop: 14 }}>
              <Projection amount={amountNum} cadence={cadence} riskBps={projectionBps} />
            </Reveal>

            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>
              Each run puts in {usd(amountNum)} ({usd(feeUsd(amountNum))} fee, no network cost) only if your balance covers it and{" "}
              {basketMode ? "the basket’s risk" : "Vera’s risk"} stays at or under your ceiling. Capped at {usd(amountNum * 2)} per period.
            </div>
          </div>
          </>
          )}

          {/* actions */}
          <div style={{ padding: "22px 22px 0" }}>
            {!active ? (
              // One CTA: it authorizes when that's the next step, and starts once it's done.
              <button className="btn btn-primary btn-block btn-lg tap" disabled={busy || (delegated && basketBlocked)} onClick={delegated ? save : authorize}>
                {busy ? <Spinner small /> : delegated ? "Start autopilot" : "Authorize Vera"}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button className="btn btn-glass btn-block btn-lg tap" disabled={busy} onClick={() => setConfirmOpen(true)}>
                  {busy ? <Spinner small /> : "Run now"}
                </button>
                <button className="btn btn-ghost btn-block btn-lg tap" disabled={busy} style={{ color: "var(--neg)" }} onClick={stop}>
                  Turn off autopilot
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* run detail — what Vera did this run */}
      <BottomSheet open={!!detailRun} onClose={() => setDetailRun(null)} title="Autopilot run">
        {detailRun &&
          (() => {
            const r = detailRun;
            const ok = r.status === "success";
            const skipped = r.status === "skipped";
            const hs = r.holdings ?? [];
            const when = new Date(r.ranAt * 1000).toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            });
            return (
              <div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  {ok ? (
                    <Seal size={42} />
                  ) : (
                    <span style={{ width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: skipped ? "var(--surface-2)" : "color-mix(in srgb, var(--neg) 16%, transparent)", color: skipped ? "var(--ink-3)" : "var(--neg)" }}>
                      <Icon name={skipped ? "clock" : "info"} size={21} stroke={2.2} />
                    </span>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 19 }}>
                    {ok ? `Invested ${usd(r.amountUsd)}` : skipped ? "Run skipped" : "Run failed"}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{when}</div>
                  {r.basketName && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-2)" }}>
                      {hs.length > 0 && <LogoCluster assets={clusterOf({ items: hs })} size={18} max={4} showRest={false} />}
                      <span>Basket · {r.basketName}</span>
                    </div>
                  )}
                </div>

                {!ok && r.reason && (
                  <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "var(--surface-2)", fontSize: 13.5, color: "var(--ink-2)", textAlign: "center", lineHeight: 1.5 }}>
                    {r.reason}
                  </div>
                )}

                {ok && hs.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <div className="label-eyebrow" style={{ marginBottom: 8 }}>What Vera bought</div>
                    <div className="card" style={{ padding: "4px 14px" }}>
                      {hs.map((h, i) => (
                        <div key={h.symbol} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < hs.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                          <TokenLogo symbol={h.symbol} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{displayFor(h.symbol).name}</div>
                            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 1 }}>{h.weightPct}% of the plan</div>
                          </div>
                          <div className="tnum" style={{ fontWeight: 700, fontSize: 14 }}>{usd(h.amountUsd)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ok && r.assessedRiskBps != null && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 16 }}>
                    <span style={{ color: "var(--ink-2)" }}>Risk Vera assessed</span>
                    <span style={{ fontWeight: 600 }}>{Math.round(r.assessedRiskBps / 100)}%</span>
                  </div>
                )}

                {ok && r.txHash && (() => {
                  const runChain = getChain(r.chain ?? apChain.key);
                  return (
                    <a href={explorerTx(runChain, r.txHash)} target="_blank" rel="noopener noreferrer" className="btn btn-glass btn-block tap" style={{ height: 46, marginTop: 18, fontSize: 14.5, textDecoration: "none" }}>
                      View on {runChain.explorer.name} <Icon name="arrowUR" size={16} />
                    </a>
                  );
                })()}
              </div>
            );
          })()}
      </BottomSheet>

      {/* run-now confirmation — money action, so confirm with a warning */}
      <BottomSheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Run now?">
        <div style={{ textAlign: "center" }}>
          <p style={{ margin: "0 auto", maxWidth: 320, fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
            Vera will invest <b style={{ color: "var(--ink)" }}>{usd(config?.amountUsd ?? amountNum)}</b> of your cash
            right now, following your current plan. This places a real on-chain order and can’t be undone.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="btn btn-ghost btn-block tap" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-block tap"
              onClick={() => {
                setConfirmOpen(false);
                void runNow();
              }}
              disabled={busy}
            >
              {busy ? <Spinner small /> : "Yes, run now"}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
