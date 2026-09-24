"use client";

// AssetDetail — Pro asset view (screens_pro.jsx · AssetDetail). Shows a REAL
// price chart (/api/market: Yahoo Finance for the equities our tokenized stocks
// track, CoinGecko for the token tier), plain-language about copy, and the user's
// REAL position in this asset (from usePortfolio). Buy/Sell open the manual Trade
// screen (useQuote + useSwap, gasless) — manual trades don't need the executor,
// so they work even while a chain's Stax contracts are still being switched on.
// Assets with no liquid market yet are tagged "Coming soon" with the buy disabled
// and the reason spelled out.
import { useState } from "react";
import type { Asset } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { usePortfolio } from "@/hooks/useBalances";
import { usePortfolioHistory } from "@/hooks/usePortfolioHistory";
import { useAssetPrice } from "@/hooks/usePrices";
import { useMarketHistory, type MarketRange } from "@/hooks/useMarket";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useBaskets } from "@/hooks/useBaskets";
import { useRwaTicker, primaryVenue, useBscBuyGate } from "@/hooks/useRwa";
import { useDemo } from "@/components/demo/DemoProvider";
import { displayFor } from "@/lib/displayAssets";
import { Icon, AssetTile, PriceChart, SectionTitle, Stat, MarketStatus, type PricePoint } from "@/components/design";
import { MarketStatusBadge } from "@/components/lite/rwa/MarketStatusBadge";
import { PriceGap } from "@/components/lite/rwa/PriceGap";
import { VenuePicker } from "@/components/lite/rwa/VenuePicker";
import { Money, Reveal, Tick, useFlashRow } from "@/components/motion";
import { usd, tokenQty, timeAgo } from "@/lib/format";
import { priceSeries } from "@/lib/demoSeries";
import type { Lot } from "@/lib/positions";
import { iconBtn } from "./primitives";
import { ComingTag, yieldLine } from "./MarketScreen";
import { BasketRailTile } from "./basketPrimitives";
import { readoutDate, timeSeries } from "./useRangeSeries";
import type { LoopParams } from "../LiteApp";

const RANGES = ["1D", "1W", "1M", "1Y", "5Y"] as const;
/** Lots shown before "Show all". */
const LOTS_PREVIEW = 3;

/** "Sep 6" / "Sep 6, 2025" for a lot's date. */
function lotDate(at: number, nowMs: number): string {
  const d = new Date(at * 1000);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Units for a lot row — same trimming as the position card. */
function lotQty(qty: number, decimals: number): string {
  try {
    return tokenQty(BigInt(Math.round(qty * 10 ** decimals)), decimals);
  } catch {
    return qty.toFixed(4);
  }
}

/** One key-fact row; `wide` stacks label over value for sentence-length facts. */
interface Fact {
  k: string;
  v: string;
  wide?: boolean;
}

export function AssetDetailScreen({
  go,
  symbol,
  loop,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol: string;
  /** After a trade: the position card flashes once (LiteApp's closing-the-loop plumbing). */
  loop?: LoopParams;
}) {
  const chain = useChain();
  const demo = useDemo();
  const asset: Asset = chain.assets.all.find((a) => a.symbol === symbol) ?? chain.assets.all[0];
  const d = displayFor(asset.symbol, asset.name);
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const holding = port?.holdings.find((h) => h.asset.symbol === asset.symbol);
  // Cost basis + lots (same query Owned uses at its default range, so it's warm).
  const { data: hist } = usePortfolioHistory(address ?? undefined, "1M");
  const position = hist?.positions.find((p) => p.symbol === asset.symbol);
  const lots: Lot[] = position ? [...position.lots].reverse() : [];
  const [allLots, setAllLots] = useState(false);
  const { price: live } = useAssetPrice(asset.symbol);
  const livePrice = live?.priceUsd;
  const liveApy = live?.apy;
  const shownPrice = livePrice ?? d.price;
  const safe = asset.tier === "safe";
  const stock = asset.tier === "stock";
  // Coinbase B20 stocks (Base): dividends grow the token instead of paying cash.
  const coinbaseStock = stock && chain.key === "base";
  const yieldText = safe ? yieldLine(liveApy, d.apy) : undefined;
  const coming = Boolean(asset.coming || d.coming);
  // BSC: each stock is issued by bStock and/or Ondo, and either can be paused or off-hours
  // independent of the plain "coming soon" gate above. `rwaTicker` is undefined off BSC,
  // before Task 9's catalog API exists, or while it's still loading — the buy button only
  // reacts to a real answer, never to the absence of one.
  const bsc = chain.key === "bsc";
  const rwaTicker = useRwaTicker(asset.symbol);
  const venue = rwaTicker ? primaryVenue(rwaTicker) : undefined;
  // The buy gate has to agree with what a manual buy actually does: `go("trade", { symbol })`
  // resolves straight to `asset.address` (the default venue), never to `rwaTicker.bestVenue` —
  // so a paused default with a buyable twin must still block Buy, and the gate must fail closed
  // (not open) before the catalog has answered at all. bscBuyGate in useRwa.ts is the single
  // tested rule; this screen just reads its verdict.
  const bscGate = useBscBuyGate(asset.symbol, asset.address);
  const buyVenue = bscGate.status === "ready" ? bscGate.venue : undefined;
  const bscBuyable = bsc ? bscGate.status === "ready" && bscGate.buyable : undefined;
  const [r, setR] = useState(2);
  const range = RANGES[r] as MarketRange;
  const [hover, setHover] = useState<(PricePoint & { index: number }) | null>(null);
  const [now] = useState(() => Date.now());
  // Baskets this asset sits in — a row of rail tiles under the position.
  const { all: baskets } = useBaskets();
  const related = baskets.filter((b) => b.items.some((i) => i.symbol === asset.symbol));
  // After a trade the position card washes once (keyed so it never replays).
  const { ref: posRef, className: posFlash } = useFlashRow<HTMLDivElement>(
    holding && loop?.flash.includes(asset.symbol) ? `${asset.symbol}:${loop.txHash}` : undefined,
  );

  // REAL market history for the selected range (server-cached; keepPreviousData
  // makes range switches seamless). Assets with no live source (or an upstream
  // outage) fall back to the windowed reference series so the chart never blanks.
  // Demo: the deterministic seeded series (stable screenshots, real dates).
  const { data: market } = useMarketHistory(demo ? undefined : asset.symbol, range);
  const points: PricePoint[] = (() => {
    if (demo) {
      // The seeded series ends at the reference price; rescale it onto the live
      // price on screen so the chart, the headline and the position agree.
      const base = priceSeries(asset.symbol, range);
      const end = base[base.length - 1]?.v;
      const k = shownPrice !== undefined && end ? shownPrice / end : 1;
      return base.map((pt) => ({ t: pt.t, v: Number((pt.v * k).toFixed(4)) }));
    }
    if (market?.series && market.series.length > 1) {
      return timeSeries(market.series, range, Date.parse(market.asOf) || now);
    }
    const RANGE_FRAC: Record<MarketRange, number> = { "1D": 0.18, "1W": 0.38, "1M": 0.6, "1Y": 0.82, "5Y": 1 };
    const s = d.spark ?? [];
    const n = Math.max(2, Math.round(s.length * RANGE_FRAC[range]));
    return timeSeries(s.slice(s.length - n), range, now);
  })();
  const first = points[0]?.v;
  const last = points[points.length - 1]?.v;
  // Change across the selected range — real when we have market data (1D is vs
  // the previous session's close, like a broker shows it).
  const rangeChange =
    (demo ? undefined : market?.changePct) ??
    (first !== undefined && last !== undefined && first > 0 ? ((last - first) / first) * 100 : d.day);
  const winUp = rangeChange >= 0;
  // Scrub readout: price at the cursor and its move since the start of the range.
  const scrubChange = hover && first !== undefined && first > 0 ? ((hover.v - first) / first) * 100 : undefined;
  const readUp = (scrubChange ?? rangeChange) >= 0;

  // Key facts under About — a clean label/value list (not fat pill cards).
  const TYPE_LABEL: Record<string, string> = {
    stock: "Stock",
    fund: "Fund · ETF",
    safe: "Cash · earns yield",
    crypto: "Crypto",
  };
  const heldAs =
    d.kind === "crypto" ? "Tokenized coin" : d.kind === "safe" ? "Yield account" : "Real shares";
  const facts: Fact[] = [
    { k: "Type", v: TYPE_LABEL[d.kind ?? "stock"] ?? "Stock" },
    { k: "Category", v: d.cat },
    ...(yieldText
      ? [{ k: "Rate", v: yieldText.replace("earns ", "").replace(" · rate can change", ", can change") }]
      : d.apy
        ? [{ k: "Rate", v: `about ${d.apy.replace("~", "")} a year, can change` }]
        : []),
    // Reference price = the last official stock-market price (Chainlink), with
    // its age — it only moves while the market is open, so "2h ago" is honest.
    ...(live?.marketPrice !== undefined
      ? [
          {
            k: "Reference price",
            v: `${usd(live.marketPrice)}${live.marketPriceAt ? ` · updated ${timeAgo(live.marketPriceAt)}` : ""}`,
          },
        ]
      : []),
    { k: "Held as", v: heldAs },
    ...(live?.sharesPerToken !== undefined && live.sharesPerToken !== 1
      ? [{ k: "Shares per token", v: `1 token = ${live.sharesPerToken.toFixed(2)} shares` }]
      : []),
    ...(coinbaseStock
      ? [{ k: "Dividends", v: "Reinvested automatically — your token grows instead of paying cash", wide: true }]
      : []),
    ...(stock ? [{ k: "Issued by", v: chain.issuer.replace(" tokenized stocks", "") }] : []),
    { k: "Network", v: chain.name },
  ];
  // BSC: the earliest next open among this ticker's venues, for "Market closed · opens …".
  // Undefined when every venue that's off gives no next-open time (e.g. a plain pause).
  const bscOpensAt =
    bscBuyable === false
      ? rwaTicker?.venues
          .map((v) => v.nextOpenMs)
          .filter((t): t is number => t !== null)
          .sort((a, b) => a - b)[0]
      : undefined;
  const bscOpensLabel =
    bscOpensAt !== undefined
      ? new Date(bscOpensAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
      : undefined;
  // "Checking…" and "unavailable" are distinct from a confirmed closed market: a quick tap
  // before the catalog loads, or a `/api/rwa` error, must never read as an open invitation, but
  // it also shouldn't claim a close nobody confirmed.
  const reason = coming
    ? `Not buyable on ${chain.name} yet: there’s no liquid market for it. We’ll switch it on as soon as there is.`
    : bsc && bscGate.status === "loading"
      ? "Checking market…"
      : bsc && bscGate.status === "unavailable"
        ? "Market status unavailable"
        : bscBuyable === false
          ? bscOpensLabel
            ? `Market closed · opens ${bscOpensLabel}`
            : "Market closed right now — check back shortly."
          : undefined;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
      </div>

      <Reveal>
      <div
        style={{ padding: "12px 22px 0", display: "flex", alignItems: "center", gap: 14 }}
      >
        <AssetTile asset={d} size={54} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em", overflowWrap: "anywhere" }}>{d.name}</h1>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
            {(d.ticker ?? asset.symbol) + " · " + d.cat}
          </div>
        </div>
        {coming && <ComingTag long />}
      </div>

      {/* price — live (Tick washes on change), or the scrubbed point while the
          finger is on the chart */}
      <div style={{ padding: "18px 22px 0" }} aria-live="polite">
        <div className="tnum" style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-.03em", minHeight: 43 }}>
          {hover ? (
            <span>{usd(hover.v)}</span>
          ) : shownPrice !== undefined ? (
            <Tick value={shownPrice} />
          ) : (
            "—"
          )}
        </div>
        {safe && !hover ? (
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink-2)", marginTop: 2 }}>
            {yieldText ?? "a dollar that stays a dollar"}
          </div>
        ) : (
          <div
            className="tnum"
            style={{ fontSize: 14.5, fontWeight: 700, color: readUp ? "var(--pos)" : "var(--neg)", marginTop: 2 }}
          >
            {(readUp ? "+" : "") + (scrubChange ?? rangeChange).toFixed(2)}%{" "}
            <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>
              · {hover ? readoutDate(hover.t, range) : RANGES[r]}
            </span>
          </div>
        )}
        {/* stock-market clock — only stocks have a market that closes. BSC leads with the
            venue's own state (a bStock pause isn't the same event as the NYSE closing) plus
            the on-chain-vs-reference gap; the generic NYSE calendar is the honest fallback
            while the catalog hasn't loaded (its "reference price only moves in market hours"
            fact is exactly what a bStock row falls back to — docs/BINANCE-WEB3.md §2). */}
        {stock && (
          <div style={{ marginTop: 14 }}>
            {bsc && rwaTicker ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 7 }}>
                {venue && <MarketStatusBadge state={venue.state} nextOpenMs={venue.nextOpenMs} />}
                <PriceGap ticker={asset.symbol} venues={rwaTicker.venues} />
              </div>
            ) : (
              <MarketStatus detail />
            )}
          </div>
        )}
      </div>

      {/* chart — scrub for a price + date, min/max at the extremes, morphs on range change */}
      <div style={{ padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: "16px 14px 12px" }}>
          <PriceChart
            points={points}
            up={winUp}
            area
            height={216}
            ranges={RANGES}
            range={RANGES[r]}
            onRange={(rr) => {
              setHover(null);
              setR(RANGES.indexOf(rr as (typeof RANGES)[number]));
            }}
            onScrub={setHover}
            label={`${d.name} price chart, ${winUp ? "up" : "down"} ${Math.abs(rangeChange).toFixed(1)}% over ${RANGES[r]}`}
          />
        </div>
      </div>

      {/* venues — BSC only: bStock and Ondo both mint this ticker, at their own prices
          and their own trading state, so the choice is shown rather than picked silently */}
      {bsc && rwaTicker && rwaTicker.venues.length > 0 && (
        <div style={{ padding: "18px 22px 0" }}>
          <SectionTitle>Venues</SectionTitle>
          {/* No `onSelect`: a manual buy always resolves to `asset.address` regardless of which
              row is highlighted (Task 12 wires a real choice into the trade), so the picker
              stays display-only and highlights the venue Buy will actually use, not whichever
              is priced closest to the reference. */}
          <VenuePicker venues={rwaTicker.venues} bestVenue={buyVenue?.platform ?? rwaTicker.bestVenue} />
        </div>
      )}

      {/* your position — value is shares × the price shown above, always;
          avg cost + gain from the lots when we know them */}
      {holding && (
        <div style={{ padding: "18px 22px 0" }}>
          <SectionTitle>Your position</SectionTitle>
          <div
            ref={posRef}
            className={`card ${posFlash}`.trim()}
            style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", columnGap: 16, rowGap: 16 }}
          >
            <Stat
              label="Value"
              value={
                shownPrice !== undefined ? (
                  <Money value={holding.qty * shownPrice} />
                ) : holding.valueUsd !== undefined ? (
                  usd(holding.valueUsd)
                ) : (
                  "—"
                )
              }
            />
            <Stat
              label={asset.tier === "stock" ? "Shares" : "Amount"}
              value={tokenQty(holding.raw, asset.decimals ?? 18)}
            />
            {shownPrice !== undefined && (
              <Stat label="Price" value={usd(shownPrice)} />
            )}
            {position && position.costBasisUsd > 0 && (
              <>
                <Stat label="Avg cost" value={usd(position.avgCostPerUnit)} />
                {position.unrealizedUsd !== null && position.unrealizedPct !== null && (
                  <Stat
                    label="Gain"
                    accent={position.unrealizedUsd >= 0 ? "var(--pos)" : "var(--neg)"}
                    value={
                      <>
                        {position.unrealizedUsd >= 0 ? "+" : "-"}
                        {usd(Math.abs(position.unrealizedUsd))}
                        <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 5 }}>
                          {position.unrealizedPct >= 0 ? "+" : ""}
                          {position.unrealizedPct.toFixed(2)}%
                        </span>
                      </>
                    }
                  />
                )}
              </>
            )}
          </div>

          {/* your buys — every lot, newest first; sells show as "Sold" */}
          {lots.length > 0 && (
            <Reveal key={`${asset.symbol}:${lots.length}`} style={{ marginTop: 14 }}>
              <SectionTitle>{lots.some((l) => l.side === "sell") ? "Your trades" : "Your buys"}</SectionTitle>
              <div className="card" style={{ padding: "4px 16px" }}>
                {(allLots ? lots : lots.slice(0, LOTS_PREVIEW)).map((l, i) => (
                  <div
                    key={`${l.txHash}:${l.side}:${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 0",
                      borderTop: i ? "1px solid var(--line-2)" : "none",
                      fontSize: 14,
                    }}
                  >
                    <span style={{ color: "var(--ink-2)", flex: "none", minWidth: 58 }}>{lotDate(l.at, now)}</span>
                    <span className="tnum" style={{ flex: 1, minWidth: 0, color: l.side === "sell" ? "var(--ink-2)" : "var(--ink)" }}>
                      {l.side === "sell" ? "Sold " : ""}
                      {lotQty(l.qty, asset.decimals ?? 18)}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)", letterSpacing: ".04em", textTransform: "uppercase" }}>
                      {l.kind === "vera" ? "Vera" : "You"}
                    </span>
                    <span className="tnum" style={{ fontWeight: 600, minWidth: 64, textAlign: "right" }}>
                      {usd(l.usdc)}
                    </span>
                  </div>
                ))}
                {lots.length > LOTS_PREVIEW && (
                  <button
                    className="tap"
                    onClick={() => setAllLots((v) => !v)}
                    style={{
                      width: "100%",
                      padding: "11px 0 9px",
                      borderTop: "1px solid var(--line-2)",
                      background: "none",
                      color: "var(--primary)",
                      fontSize: 13.5,
                      fontWeight: 600,
                      textAlign: "center",
                    }}
                  >
                    {allLots ? "Show less" : `Show all ${lots.length}`}
                  </button>
                )}
              </div>
            </Reveal>
          )}
        </div>
      )}

      {/* in these baskets — ready-made mixes that hold this asset */}
      {related.length > 0 && (
        <div style={{ padding: "18px 0 0" }}>
          <div style={{ padding: "0 22px" }}>
            <SectionTitle action="All baskets" onAction={() => go("baskets")}>
              In these baskets
            </SectionTitle>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              padding: "2px 22px 6px",
              overflowX: "auto",
              margin: "-2px 0 -6px",
            }}
          >
            {related.map((b) => (
              <BasketRailTile key={b.id} basket={b} onClick={() => go("basket", { id: b.id })} />
            ))}
            <span aria-hidden style={{ flex: "none", width: 12 }} />
          </div>
        </div>
      )}

      {/* about — heading + prose share the same left edge (no card wrapper). */}
      <div style={{ padding: "18px 22px 0" }}>
        <SectionTitle>About</SectionTitle>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
          {d.desc}
        </p>

        {/* key facts — tidy label/value list */}
        <div className="card" style={{ marginTop: 14, padding: "4px 16px" }}>
          {facts.map((f, i) => (
            <div
              key={f.k}
              style={{
                display: "flex",
                flexDirection: f.wide ? "column" : "row",
                justifyContent: "space-between",
                alignItems: f.wide ? "stretch" : "center",
                gap: f.wide ? 3 : 16,
                padding: "12px 0",
                borderTop: i ? "1px solid var(--line-2)" : "none",
                fontSize: 14.5,
              }}
            >
              <span style={{ color: "var(--ink-2)", flex: "none" }}>{f.k}</span>
              <span style={{ fontWeight: 600, color: "var(--ink)", textAlign: f.wide ? "left" : "right", lineHeight: 1.4 }}>
                {f.v}
              </span>
            </div>
          ))}
        </div>
      </div>

      </Reveal>

      {/* CTA — manual buy/sell (no executor needed). Disabled with the reason
          when there's no liquid market yet. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 5,
          marginTop: "auto",
          padding: "16px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)",
        }}
      >
        {reason && (
          <p role="status" style={{ margin: "0 0 10px", textAlign: "center", fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {reason}
          </p>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn btn-ghost tap"
            style={{ flex: 1 }}
            disabled={!holding || coming}
            onClick={() => go("trade", { symbol: asset.symbol, side: "sell" })}
          >
            Sell
          </button>
          <button
            className="btn btn-primary tap"
            style={{ flex: 2 }}
            disabled={coming || bscBuyable === false}
            onClick={() => go("trade", { symbol: asset.symbol, side: "buy" })}
          >
            {coming
              ? "Coming soon"
              : bsc && bscGate.status === "loading"
                ? "Checking market…"
                : bsc && bscGate.status === "unavailable"
                  ? "Market status unavailable"
                  : bscBuyable === false
                    ? "Market closed"
                    : "Buy"}
          </button>
        </div>
      </div>
    </div>
  );
}
