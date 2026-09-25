"use client";

// AssetDetail — Pro asset view (screens_pro.jsx · AssetDetail). Shows a REAL
// price chart (/api/market: Yahoo Finance for the equities our tokenized stocks
// track, CoinGecko for the token tier), plain-language about copy, and the user's
// REAL position in this asset (from usePortfolio). Buy/Sell open the manual Trade
// screen (useQuote + useSwap, gasless) — manual trades don't need the executor,
// so they work even while a chain's Stax contracts are still being switched on.
// Assets with no liquid market yet are tagged "Coming soon" with the buy disabled
// and the reason spelled out.
import { useEarnings } from "@/hooks/useEarnings";
import { EarningsChip } from "@/components/lite/earnings/EarningsChip";
import { useState } from "react";
import type { Asset, RwaPlatform } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { usePortfolio } from "@/hooks/useBalances";
import { usePortfolioHistory } from "@/hooks/usePortfolioHistory";
import { useAssetPrice } from "@/hooks/usePrices";
import { useMarketHistory, type MarketRange } from "@/hooks/useMarket";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useBaskets } from "@/hooks/useBaskets";
import { useRwa, useBscBuyGate } from "@/hooks/useRwa";
import { useSpreadHistory } from "@/hooks/useSpread";
import { PriceVsRealShare } from "@/components/lite/spread/PriceVsRealShare";
import { historyStatus } from "@/lib/priceHistoryStatus";
import { chosenVenueFor } from "@/lib/assetVenuePicker";
import { useDemo } from "@/components/demo/DemoProvider";
import { displayFor } from "@/lib/displayAssets";
import { pickHolding, resolveVenueAddress } from "@/lib/venues";
import { Icon, AssetTile, PriceChart, SectionTitle, Stat, MarketStatus, type PricePoint } from "@/components/design";
import { MarketStatusBadge } from "@/components/lite/rwa/MarketStatusBadge";
import { PriceGap } from "@/components/lite/rwa/PriceGap";
import { VenuePicker, PLATFORM_LABEL } from "@/components/lite/rwa/VenuePicker";
import { formatOpensLocal } from "@/lib/marketHours";
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
  venue: openedVenue,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol: string;
  /** BSC: the issuer whose holding row opened this screen (a twin position), if any. */
  venue?: RwaPlatform;
  /** After a trade: the position card flashes once (LiteApp's closing-the-loop plumbing). */
  loop?: LoopParams;
}) {
  const chain = useChain();
  const demo = useDemo();
  const asset: Asset = chain.assets.all.find((a) => a.symbol === symbol) ?? chain.assets.all[0];
  const d = displayFor(asset.symbol, asset.name);
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const holding = pickHolding(port?.holdings, chain, asset, openedVenue);
  // Cost basis + lots (same query Owned uses at its default range, so it's warm).
  const { data: hist } = usePortfolioHistory(address ?? undefined, "1M");
  const position = hist?.positions.find((p) => p.symbol === asset.symbol);
  const lots: Lot[] = position ? [...position.lots].reverse() : [];
  const [allLots, setAllLots] = useState(false);
  const { price: live } = useAssetPrice(asset.symbol);
  const livePrice = live?.priceUsd;
  const liveApy = live?.apy;
  // Design critique P1 #5: on BSC this is overridden below to the CHOSEN issuer's own price,
  // once that venue is known — the generic oracle price disagreed with the venue a viewer had
  // just picked on the panel further down this same screen.
  let shownPrice = livePrice ?? d.price;
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
  const earnings = useEarnings(bsc && asset.tier === "stock" ? asset.symbol : undefined);
  // `useRwa()` directly (not the `useRwaTicker` convenience wrapper) so this screen also gets
  // `refetch` — the "Try again" CTA (design critique P1 #12) needs to re-ask /api/rwa without a
  // full page reload. Same query key as every other BSC hook, so this shares the cache rather
  // than firing a second request.
  const rwaQuery = useRwa();
  const rwaTicker = rwaQuery.data?.tickers.find((t) => t.ticker === asset.symbol);
  // Which issuer Buy will actually use: an explicit tap on the Venues panel, else the issuer the
  // screen was opened with (a "Which is cheaper?" row or a twin holding — `openedVenue`), else
  // the catalog's bestVenue, else the asset's own platform — the same fallback order VenuePicker
  // itself uses for its ring, so the highlighted row and the button never disagree about the
  // venue. A picked or opened venue that stops trading (the issuer pauses mid-session) falls back
  // the same way VenuePicker's own ring does, rather than keep pointing the buy at a venue that
  // just went dark. `chosenVenueFor` is the tested rule (lib/assetVenuePicker.ts) — this line just
  // reads its verdict. Regression: this used to start the picker at `undefined` and ignore
  // `openedVenue` entirely, so tapping "Ondo is cheaper" on the board could still land on bStock.
  const [pickedVenue, setPickedVenue] = useState<RwaPlatform | undefined>(undefined);
  const defaultVenue = rwaTicker?.bestVenue ?? asset.platform;
  const chosenVenue = chosenVenueFor(pickedVenue, openedVenue, rwaTicker?.venues, defaultVenue);
  // The chosen issuer's own row — the single source for the price, the gap sentence and the
  // status badge above the chart (design critique P0 #3 / P1 #5), so all three always describe
  // the same venue instead of "whichever is first" or the default the viewer just tapped past.
  const chosenVenueView = rwaTicker?.venues.find((v) => v.platform === chosenVenue);
  if (bsc && chosenVenueView) shownPrice = chosenVenueView.tokenPrice;
  const chosenAddress = bsc ? (resolveVenueAddress(chain, asset, chosenVenue)?.address ?? asset.address) : asset.address;
  // The buy gate has to agree with what a manual buy actually does: `go("trade", { symbol, venue })`
  // resolves through resolveVenueAddress to `chosenAddress`, so the gate checks THAT venue's
  // buyability, not always the asset's own default — a paused default with a buyable twin the
  // viewer picked must enable Buy, and a buyable default with a picked-but-paused twin must not.
  // The gate still fails closed (not open) before the catalog has answered at all — bscBuyGate in
  // useRwa.ts is the single tested rule; this screen just reads its verdict for the chosen venue.
  const bscGate = useBscBuyGate(asset.symbol, chosenAddress);
  // Price vs the real share, for the chosen issuer only — mounted under "Who you buy from" below.
  // Crypto (no `platform`) never queries this: there's no issuer, no reference price to compare.
  const { data: spreadHistory, isLoading: historyLoading, isError: historyErrored } = useSpreadHistory(
    bsc && asset.platform ? asset.symbol : undefined,
  );
  const chosenHistoryPoints = chosenVenue
    ? (spreadHistory?.venues.find((v) => v.platform === chosenVenue)?.points ?? [])
    : [];
  // "loading"/"error" mean the fetch that would back up "empty" hasn't succeeded yet — see
  // lib/priceHistoryStatus.ts. Regression: without this, every BSC stock page briefly (or, on a
  // fetch error, permanently) claimed "we start recording this stock's price history" before the
  // request that would actually confirm that had returned anything.
  const chosenHistoryStatus = historyStatus(chosenHistoryPoints.length, { isLoading: historyLoading, isError: historyErrored });
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
    // Design critique P1 #6: on BSC this was the whole "Tokenized stocks on BNB Chain are
    // issued by bStock and Ondo, not by Stax" sentence, however many issuers actually exist —
    // here it names the one issuer this screen is about to buy from.
    ...(stock
      ? [
          {
            k: "Issued by",
            v: bsc ? (chosenVenueView ? PLATFORM_LABEL[chosenVenueView.platform] : "bStock and Ondo") : chain.issuer.replace(" tokenized stocks", ""),
          },
        ]
      : []),
    { k: "Network", v: chain.name },
  ];
  const chosenPlatformLabel = chosenVenueView ? PLATFORM_LABEL[chosenVenueView.platform] : undefined;
  // "Checking…" and "unavailable" are distinct from a confirmed closed market: a quick tap
  // before the catalog loads, or a `/api/rwa` error, must never read as an open invitation, but
  // it also shouldn't claim a close nobody confirmed. Design critique P0 #1 / P1 #12 / P2 #14:
  // one shared local-time formatter, a plain-words reason with an actual next step, and a
  // paused issuer named instead of a generic "market closed".
  const reason = coming
    ? `Not buyable on ${chain.name} yet: there’s no liquid market for it. We’ll switch it on as soon as there is.`
    : bsc && bscGate.status === "loading"
      ? "Checking market…"
      : bsc && bscGate.status === "unavailable"
        ? "Couldn't check if the market is open."
        : bscBuyable === false
          ? // Reviewer follow-up on design critique P1 #8/#14: `nextOpenMs` is never null on a
            // real paused OR unsupported row (`rwaCatalog.ts`'s `buildVenue` always fills it in
            // for any non-buyable venue), so this must branch on `state` alone — checking
            // `nextOpenMs === null` too meant a mid-session pause never took this branch and
            // instead read a reopen time nobody promised, and a ticker Binance flatly doesn't
            // support would have read the same false "Closed · opens ..." line.
            chosenVenueView?.state === "paused"
            ? `${chosenPlatformLabel ?? "The issuer"} has paused ${d.name} for now. Check back shortly.`
            : chosenVenueView?.state === "unsupported"
              ? `${d.name} isn’t one Binance can trade on BNB Chain.`
              : chosenVenueView?.nextOpenMs != null
                ? `Closed · ${formatOpensLocal(chosenVenueView.nextOpenMs, now)}`
                : "Market closed right now — check back shortly."
          : undefined;
  // Design critique P0 #2: Sell must be gated the same way Buy is — a twin holding sells through
  // its OWN issuer, so it's that venue's buyability that decides, not the ticker's default. Fails
  // closed while the catalog hasn't answered yet, same as `bscBuyable` above.
  const sellVenue = holding?.venue ?? defaultVenue;
  const sellVenueView = rwaTicker?.venues.find((v) => v.platform === sellVenue);
  const sellBlocked = bsc && !sellVenueView?.buyable;
  // Design critique P1 #12: a fetch error shouldn't be a dead end — offer the retry it needs.
  const unavailable = bsc && bscGate.status === "unavailable";

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
            CHOSEN venue's own state (a bStock pause isn't the same event as the NYSE closing)
            plus its on-chain-vs-reference gap, so the badge, the gap sentence and the price
            above all describe the same issuer (design critique P0 #3 / P1 #5). Off BSC, the
            generic NYSE calendar is the honest fallback while the catalog hasn't loaded (its
            "reference price only moves in market hours" fact is exactly what a bStock row falls
            back to — docs/BINANCE-WEB3.md §2). Reviewer follow-up on P0 #1: BSC must never fall
            back to THAT pill instead — its ET-labelled "trades still go through, prices can
            drift" line is also flatly wrong on BSC, where a closed quote is refused outright, not
            filled at a drifted price. While `/api/rwa` is loading, erroring or simply missing
            this ticker, BSC shows a neutral placeholder, not a false clock. */}
        {stock && (
          <div style={{ marginTop: 14 }}>
            {bsc && rwaTicker ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 7 }}>
                {chosenVenueView && (
                  <MarketStatusBadge
                    state={chosenVenueView.state}
                    nextOpenMs={chosenVenueView.nextOpenMs}
                    buyable={chosenVenueView.buyable}
                    platform={chosenVenueView.platform}
                  />
                )}
                <PriceGap venue={chosenVenueView} />
                {earnings && <EarningsChip info={earnings} />}
              </div>
            ) : bsc ? (
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-3)" }}>
                {bscGate.status === "unavailable" ? "Couldn't check the market." : "Checking market…"}
              </span>
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
          {/* Design critique P0 #4: "Venues" named a category, not a decision. */}
          <SectionTitle>Who you buy from</SectionTitle>
          {/* Reviewer-found regression: this used to pass `bestVenue={defaultVenue}` — the
              catalog's smallest-gap pick — so the ring could highlight one issuer (e.g. bStock,
              the smallest-gap venue) while Buy targeted another (e.g. Ondo, the cheaper-price
              venue a board row opened this screen with). VenuePicker uses `bestVenue` for both
              its ring and its "Best right now" tag; until it grows a `selected` prop that can
              drive the ring independently (wiringNeeded — VenuePicker isn't owned here), we feed
              it `chosenVenue` so the ring and the Buy button can never disagree. The tradeoff:
              "Best right now" can now tag the tapped/opened venue rather than strictly the
              catalog's smallest-gap venue when the two differ. */}
          <VenuePicker venues={rwaTicker.venues} bestVenue={rwaTicker.bestVenue} selected={chosenVenue ?? null} onSelect={setPickedVenue} />
          {/* Price vs the real share, for whichever issuer is chosen above — one line chart, a
              plain sentence once we've actually confirmed there's nothing to draw yet, or nothing
              at all while that confirmation is still in flight (never a guess dressed as a fact). */}
          {chosenHistoryStatus === "loading" || chosenHistoryStatus === "error" ? null : chosenHistoryStatus === "empty" ? (
            <p style={{ margin: "12px 2px 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-3)" }}>
              No price history for this stock yet. Check back later today.
            </p>
          ) : (
            <div style={{ marginTop: 12 }}>
              <PriceVsRealShare ticker={asset.symbol} points={chosenHistoryPoints} />
            </div>
          )}
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
                // A twin position is priced at its own issuer's token, which the portfolio
                // already did; the headline price is the default venue's.
                holding.venue !== undefined && holding.venue !== asset.platform && holding.valueUsd !== undefined ? (
                  usd(holding.valueUsd)
                ) : shownPrice !== undefined ? (
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
            disabled={!holding || coming || sellBlocked}
            // A twin holding sells its own token — carry the venue the position was actually
            // bought through, not the ticker's default, or the sell would try to move a token
            // this account never held.
            onClick={() => go("trade", { symbol: asset.symbol, side: "sell", venue: bsc ? holding?.venue : undefined })}
          >
            Sell
          </button>
          <button
            className="btn btn-primary tap"
            style={{ flex: 2 }}
            disabled={!unavailable && (coming || bscBuyable === false)}
            onClick={() => {
              if (unavailable) {
                void rwaQuery.refetch();
                return;
              }
              go("trade", { symbol: asset.symbol, side: "buy", venue: bsc ? chosenVenue : undefined });
            }}
          >
            {coming
              ? "Coming soon"
              : bsc && bscGate.status === "loading"
                ? "Checking market…"
                : unavailable
                  ? "Try again"
                  : bscBuyable === false
                    ? "Market closed"
                    : "Buy"}
          </button>
        </div>
      </div>
    </div>
  );
}
