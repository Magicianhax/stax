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
  LogoCluster,
  RiskMeter,
  PriceChart,
  VerifiedBadge,
  BottomSheet,
  ChainLaunching,
  useToast,
  type PricePoint,
} from "@/components/design";
import { Reveal } from "@/components/motion";
import { useBaskets } from "@/hooks/useBaskets";
import { useGiftsEnabled } from "@/hooks/useGifts"; // gift-ui
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
import { RampWeightBar, clusterOf, fmtPct, shareBasket } from "./basketPrimitives";
import { useSymbolSeries, blendSeries, changeOf, readoutDate } from "./useRangeSeries";

const QUICK_AMOUNTS = [50, 100, 300, 500];
const RANGES = ["1W", "1M", "1Y"] as const;
type Range = (typeof RANGES)[number];
const RANGE_WORD: Record<Range, string> = { "1W": "past week", "1M": "past month", "1Y": "past year" };

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
  const { byId, mine, save, remove, publish } = useBaskets();
  const { notify } = useToast();
  const giftsOn = useGiftsEnabled(); // gift-ui
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const balance = bal?.value ?? 0;

  // Once a shared basket is saved, the stored copy (author "you") takes over.
  const basket = byId(shared?.id) ?? shared ?? byId(id);
  // Only "since you saved it" still comes from here; the chart blends its own series.
  const perf = useBasketPerformance(basket);
  const [sheet, setSheet] = useState(false);
  const [amt, setAmt] = useState("100");
  const amount = parseFloat(amt);

  // Performance chart: what $100 in this mix would have done over the range,
  // blended from each holding's series (demo: seeded; real: /api/market).
  const [range, setRange] = useState<Range>("1M");
  const [hover, setHover] = useState<(PricePoint & { index: number }) | null>(null);
  const items = useMemo(() => basket?.items ?? [], [basket]);
  const symbols = useMemo(() => items.map((i) => i.symbol), [items]);
  const { series, loading: seriesLoading } = useSymbolSeries(symbols, range);
  const points = useMemo(
    () => blendSeries(items.map((i) => ({ points: series.get(i.symbol) ?? [], weight: i.weightPct })), { anchor: "start" }),
    [items, series],
  );
  const change = changeOf(points);
  const chartUp = change.pct >= 0;

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
        <Reveal className="card" style={{ margin: "22px 22px 0", padding: "24px 18px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>That basket isn&apos;t here</div>
          <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "6px 0 0", lineHeight: 1.5 }}>
            It may have been removed, or it belongs to another network. Baskets are kept per network.
          </p>
          <button className="btn btn-ghost tap" style={{ marginTop: 14, minHeight: 44 }} onClick={() => go("baskets")}>
            See all baskets
          </button>
        </Reveal>
      </div>
    );
  }

  const risk = riskMeta(basket.riskScore);
  const basketChain = getChain(basket.chain);
  const canSave = basket.author === "shared" && !isMine;
  const canReview = investable && ready && amount > 0;

  const onShare = async () => {
    haptic.light();
    // Signed in: a short server link (`/app?b=…`); otherwise, or if that fails, the
    // self-contained encoded link — sharing always works.
    const short = await publish(basket);
    const r = await shareBasket(basket, short ?? undefined);
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
      <Reveal style={{ padding: "14px 22px 0" }}>
        <LogoCluster assets={clusterOf(basket)} size={34} />
        <div style={{ marginTop: 10, minWidth: 0 }}>
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
      </Reveal>

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

      {/* performance: $100 following this mix; scrub for a value + date */}
      <Reveal delay={0.04} style={{ padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: "14px 16px 12px" }}>
          <div
            aria-live="polite"
            style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, minHeight: 44 }}
          >
            {hover ? (
              <>
                <span className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em" }}>
                  {usd(hover.v)}
                </span>
                <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
                  {readoutDate(hover.t, range)}
                </span>
              </>
            ) : points.length > 1 ? (
              <>
                <span className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", color: chartUp ? "var(--pos)" : "var(--neg)" }}>
                  {fmtPct(change.pct)}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>{RANGE_WORD[range]}</span>
              </>
            ) : (
              <span className="skeleton" style={{ width: 92, height: 22, borderRadius: 7, display: "inline-block" }} />
            )}
          </div>
          {basket.author === "you" && (
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2, fontWeight: 600 }}>
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
          <div style={{ marginTop: 10 }}>
            {points.length > 1 ? (
              <PriceChart
                points={points}
                up={chartUp}
                area
                height={150}
                ranges={RANGES}
                range={range}
                onRange={(r) => setRange(r as Range)}
                onScrub={setHover}
                formatValue={(v) => usd(v)}
                label={`$100 in ${basket.name}, ${chartUp ? "up" : "down"} ${Math.abs(change.pct).toFixed(1)}% over the ${RANGE_WORD[range]}`}
              />
            ) : (
              <div
                className={seriesLoading ? "skeleton" : undefined}
                style={{ height: 150, borderRadius: 14, display: "grid", placeItems: "center", background: seriesLoading ? undefined : "var(--surface-2)", color: "var(--ink-2)", fontSize: 13.5, fontWeight: 600 }}
              >
                {!seriesLoading && "Not enough history to draw yet"}
              </div>
            )}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "10px 0 0", lineHeight: 1.45 }}>
            What $100 in this mix would have done, weighted the way it&apos;s built. Past returns don&apos;t promise future ones.
          </p>
        </div>
      </Reveal>

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
          <RampWeightBar items={basket.items} height={12} />
        </div>
        <Reveal className="card" style={{ padding: "4px 16px" }}>
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
        </Reveal>
      </div>

      {/* gift-ui: give this exact mix to someone else — same weights, held until a day you pick */}
      {investable && giftsOn && (
        <div style={{ padding: "14px 22px 0" }}>
          <button
            className="btn btn-ghost btn-block tap"
            style={{ minHeight: 46 }}
            onClick={() => {
              haptic.light();
              go("gift", { basketId: basket.id });
            }}
          >
            <Icon name="send" size={17} /> Gift this basket
          </button>
        </div>
      )}

      {/* secondary actions: Share lives in the header; Save / Remove only when they apply */}
      {(canSave || isMine) && (
        <div style={{ padding: "14px 22px 0", display: "flex", gap: 10 }}>
          {canSave && (
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
      )}

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
