"use client";

// Basket detail — name, tagline, risk meter, real performance, holdings with a
// one-line why, and ONE obvious action: Invest. The amount sheet hands a
// basketToAllocation() plan to PlanScreen so the user still sees Vera's review
// and the same one-tap place (nothing in placing/success/receipt changes).
//
// Reached by id (curated or yours) or with a decoded shared basket (`/app?basket=`).
import { useMemo, useState } from "react";
import {
  Icon,
  AssetTile,
  RiskMeter,
  PriceChart,
  VerifiedBadge,
  BottomSheet,
  ChainLaunching,
  useToast,
} from "@/components/design";
import { useBaskets } from "@/hooks/useBaskets";
import { useBasketPerformance } from "@/hooks/useBasketPerformance";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useUsdcBalance } from "@/hooks/useBalances";
import { getChain } from "@/lib/chains";
import { setActiveChainKey } from "@/lib/chains/active";
import { basketToAllocation, isBasketInvestable, reasonFor, riskWord, type Basket } from "@/lib/baskets";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { iconBtn } from "./primitives";
import { riskMeta } from "./PlanScreen";
import { useChainReady } from "../useChainReady";
import { BasketDisc, ReturnChip, WeightBar, fmtPct, shareBasket } from "./basketPrimitives";

const QUICK_AMOUNTS = [50, 100, 300, 500];

export function BasketDetailScreen({
  go,
  id,
  shared,
}: {
  go: (screen: string | number, params?: Record<string, unknown>) => void;
  id?: string;
  /** A basket decoded from a share link (not in storage yet). */
  shared?: Basket;
}) {
  const { chain, ready } = useChainReady();
  const { byId, mine, save, remove } = useBaskets();
  const { notify } = useToast();
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const balance = bal?.value ?? 0;

  // Once a shared basket is saved, the stored copy (author "you") takes over.
  const basket = byId(shared?.id) ?? shared ?? byId(id);
  const perf = useBasketPerformance(basket);
  const [sheet, setSheet] = useState(false);
  const [amt, setAmt] = useState("100");
  const amount = parseFloat(amt);

  const isMine = Boolean(basket && mine.some((b) => b.id === basket.id));
  const onOtherChain = Boolean(basket && basket.chain !== chain.key);
  const investable = useMemo(() => Boolean(basket && !onOtherChain && isBasketInvestable(chain, basket)), [basket, chain, onOtherChain]);

  if (!basket) {
    return (
      <div className="screen screen-pad-top">
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
          <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
            <Icon name="back" size={20} />
          </button>
        </div>
        <div className="card anim-rise" style={{ margin: "22px 22px 0", padding: "24px 18px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>That basket isn&apos;t here</div>
          <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "6px 0 0", lineHeight: 1.5 }}>
            It may have been removed, or it belongs to another network. Baskets are kept per network.
          </p>
          <button className="btn btn-ghost tap" style={{ marginTop: 14, minHeight: 44 }} onClick={() => go("baskets")}>
            See all baskets
          </button>
        </div>
      </div>
    );
  }

  const risk = riskMeta(basket.riskScore);
  const basketChain = getChain(basket.chain);
  const trendUp = (perf.returns["1M"] ?? 0) >= 0;
  const canReview = investable && ready && amount > 0;

  const onShare = async () => {
    haptic.light();
    const r = await shareBasket(basket);
    if (r === "copied") notify("Link copied", "link");
    else if (r === "failed") notify("Couldn't copy the link. Try again.", "info");
  };
  const onSave = () => {
    save({ ...basket, author: "you", createdAt: Math.floor(Date.now() / 1000) });
    haptic.light();
    notify("Saved to your baskets", "check");
  };
  const onRemove = () => {
    remove(basket.id);
    notify("Basket removed", "check");
    go(-1);
  };
  const onReview = () => {
    if (!canReview) return;
    haptic.medium();
    setSheet(false);
    go("plan", { allocation: basketToAllocation(basket, amount), amt: amount, basket });
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <button onClick={onShare} style={iconBtn} className="tap" aria-label="Share this basket">
          <Icon name="link" size={19} />
        </button>
      </div>

      {/* identity */}
      <div className="anim-rise" style={{ padding: "14px 22px 0", display: "flex", gap: 14, alignItems: "center" }}>
        <BasketDisc basket={basket} size={60} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.015em", lineHeight: 1.1 }}>
            {basket.name}
          </h1>
          <p style={{ margin: "5px 0 0", fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.45 }}>{basket.tagline}</p>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 5, fontWeight: 600 }}>
            {basket.author === "stax" && "Made by Stax"}
            {basket.author === "you" && "Saved by you"}
            {basket.author === "vera" && "Built by Vera"}
            {basket.author === "shared" && "Shared with you"}
            {" · "}
            {riskWord(basket.riskScore)}
          </div>
        </div>
      </div>

      {/* another network */}
      {onOtherChain && (
        <div style={{ padding: "16px 22px 0" }}>
          <div className="card" role="status" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>This basket lives on {basketChain.name}</div>
            <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "4px 0 0", lineHeight: 1.5 }}>
              You&apos;re on {chain.name} right now. Switch to see its prices and invest.
            </p>
            <button
              className="btn btn-ghost tap"
              style={{ marginTop: 12, minHeight: 44 }}
              onClick={() => {
                setActiveChainKey(basket.chain);
                notify(`Switched to ${basketChain.name}`, "check");
              }}
            >
              Switch to {basketChain.name}
            </button>
          </div>
        </div>
      )}

      {/* performance — real numbers or honest words, never a filler figure */}
      <div className="anim-rise" style={{ animationDelay: ".04s", padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: "14px 16px 12px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["1D", "1W", "1M"] as const).map((r) => (
              <ReturnChip key={r} value={perf.returns[r]} loading={perf.loading} label={r} />
            ))}
          </div>
          {basket.author === "you" && (
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 10, fontWeight: 600 }}>
              {perf.sinceSaved === null ? (
                perf.loading ? "Working out your return since you saved it…" : "Since you saved it: not enough history yet."
              ) : (
                <>
                  Since you saved it:{" "}
                  <span className="tnum" style={{ color: perf.sinceSaved >= 0 ? "var(--pos)" : "var(--neg)" }}>
                    {fmtPct(perf.sinceSaved)}
                  </span>
                </>
              )}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            {perf.spark ? (
              <PriceChart
                data={perf.spark}
                up={trendUp}
                height={110}
                label={
                  perf.returns["1M"] == null
                    ? `${basket.name} over the last month, return not available yet`
                    : `${basket.name} over the last month, ${trendUp ? "up" : "down"} ${Math.abs(perf.returns["1M"]).toFixed(1)}%`
                }
              />
            ) : (
              <div
                className={perf.loading ? "skeleton" : undefined}
                style={{ height: 110, borderRadius: 14, display: "grid", placeItems: "center", background: perf.loading ? undefined : "var(--surface-2)", color: "var(--ink-2)", fontSize: 13.5, fontWeight: 600 }}
              >
                {!perf.loading && "Not enough history to draw yet"}
              </div>
            )}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "10px 0 0", lineHeight: 1.45 }}>
            What this mix would have done, weighted the way it&apos;s built. Past returns don&apos;t promise future ones.
          </p>
        </div>
      </div>

      {/* risk */}
      <div style={{ padding: "12px 22px 0" }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)" }}>How bumpy this could feel</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }}>{risk.label}</span>
          </div>
          <RiskMeter level={risk.level} />
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "10px 0 0", lineHeight: 1.5 }}>
            Some ups and downs are normal. Stocks can go down too, so only invest what you can leave for a while.
          </p>
        </div>
      </div>

      {/* holdings */}
      <div style={{ padding: "18px 22px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.02em" }}>What&apos;s inside</h2>
          <span style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600 }}>
            {basket.items.length} {basket.items.length === 1 ? "holding" : "holdings"}
          </span>
        </div>
        <div style={{ marginBottom: 12 }}>
          <WeightBar items={basket.items} height={12} />
        </div>
        <div className="card stagger" style={{ padding: "4px 16px" }}>
          {basket.items.map((it, i) => {
            const tile = toTile(it.symbol);
            return (
              <div
                key={it.symbol}
                style={{ padding: "12px 0", borderBottom: i < basket.items.length - 1 ? "1px solid var(--line-2)" : "none" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <AssetTile asset={tile} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 15.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {tile.name}
                      </span>
                      <span className="tnum" style={{ fontWeight: 700, fontSize: 15, flex: "none" }}>{it.weightPct}%</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>{catFor(it.symbol)}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.45, display: "flex", gap: 7 }}>
                  <Icon name="info" size={15} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
                  {it.reason ?? reasonFor(it.symbol)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* secondary actions */}
      <div style={{ padding: "14px 22px 0", display: "flex", gap: 10 }}>
        <button className="btn btn-ghost tap" style={{ flex: 1, minHeight: 46 }} onClick={onShare}>
          <Icon name="link" size={17} /> Share
        </button>
        {basket.author === "shared" && !isMine && (
          <button className="btn btn-ghost tap" style={{ flex: 1, minHeight: 46 }} onClick={onSave}>
            <Icon name="plus" size={17} /> Save
          </button>
        )}
        {isMine && (
          <button className="btn btn-ghost tap" style={{ flex: 1, minHeight: 46, color: "var(--neg)" }} onClick={onRemove}>
            <Icon name="close" size={17} /> Remove
          </button>
        )}
      </div>

      {/* how this is built */}
      <div style={{ padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>How this is built</div>
          <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "6px 0 0", lineHeight: 1.55 }}>
            The weights are fixed: every dollar you put in is split exactly as shown. Before each invest, Vera
            checks the risk and signs it, and the plan is recorded so its track record can&apos;t be edited later.
            {basket.source?.goal && (
              <>
                {" "}
                This one started as a goal: “{basket.source.goal}”.
              </>
            )}
          </p>
        </div>
      </div>

      <div style={{ padding: "14px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Vera signs the risk before each invest" onClick={() => go("vera")} />
      </div>

      {/* Pinned invest bar — sticky, like PlanScreen. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "16px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)",
        }}
      >
        {!ready ? (
          <ChainLaunching chain={chain} />
        ) : !investable ? (
          <div role="status" style={{ textAlign: "center", fontSize: 13, color: "var(--ink-2)", fontWeight: 600, lineHeight: 1.45 }}>
            {onOtherChain
              ? `Switch to ${basketChain.name} above to invest in this basket.`
              : `Something in this basket isn't buyable on ${chain.name} right now.`}
          </div>
        ) : (
          <button className="btn btn-primary btn-block btn-lg tap" onClick={() => setSheet(true)}>
            Invest in {basket.name}
          </button>
        )}
      </div>

      {/* amount sheet */}
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="How much?">
        <div className="field" style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 16px" }}>
          <span className="tnum" style={{ fontSize: 30, fontWeight: 700, color: "var(--ink-3)" }}>$</span>
          <input
            value={amt}
            onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            aria-label="Amount to invest"
            className="tnum"
            autoFocus
            style={{ flex: 1, fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", width: "100%" }}
          />
          <span className="caption" style={{ fontWeight: 500 }}>of {usd(balance)}</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              className={`chip tap tnum ${amount === q ? "is-on" : ""}`}
              style={{ height: 40 }}
              onClick={() => setAmt(String(q))}
            >
              ${q}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "14px 0 0", lineHeight: 1.5 }}>
          You&apos;ll see the full split and Vera&apos;s risk check before anything is placed.
        </p>
        <button
          className="btn btn-primary btn-block btn-lg tap"
          style={{ marginTop: 14 }}
          disabled={!canReview}
          onClick={onReview}
        >
          Review {amount > 0 ? usd(amount) : "the plan"}
        </button>
      </BottomSheet>
    </div>
  );
}
