"use client";

// Trade — manual buy/sell wired to the REAL gasless path. BUY: useQuote (live
// venue spot on the active chain) + swap.buy (batched fee + approve + swap as
// one sponsored UserOp). SELL: useSellQuote + swap.sell (held token -> USDC).
// Venues come from lib/chains. The "Advanced" tolerance maps Tight / Normal /
// Loose to 0.5 / 1 / 3 % (the on-chain amountOutMinimum is the real protection).
//
// Flow: amount → "Review buy" → ReviewSheet (hold to confirm) → Placing →
// Receipt. `swap` is owned by LiteApp so the swap survives the route change to
// Placing; this screen only reads its state and fires buy()/sell().
import { useState } from "react";
import { isRoutable, type Asset, type RwaPlatform } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { useQuote, useSellQuote } from "@/hooks/useQuote";
import { useRwaTicker } from "@/hooks/useRwa";
import type { useSwap } from "@/hooks/useSwap";
import { useUsdcBalance, usePortfolio } from "@/hooks/useBalances";
import { usePrice } from "@/hooks/usePrices";
import { useMarketHistory } from "@/hooks/useMarket";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { displayFor } from "@/lib/displayAssets";
import { Icon, AssetTile, useMarketStatus, AmountInput, Keypad } from "@/components/design";
import { useAmountKeypad } from "@/hooks/useAmountKeypad";
import { describeNextChange } from "@/lib/marketHours";
import { stateLabel, dryRunLine, gapSentence } from "@/lib/plainCopy";
import { otherOpenVenue } from "@/lib/assetVenuePicker";
import { BSC_MIN_LEG_USD } from "@/lib/rwa";
import type { DryRun } from "@/lib/dryRun";
import { usd, tokenQty, fromUnits } from "@/lib/format";
import { feeUsd, feeOf } from "@/lib/fees";
import { usdToRaw } from "@/lib/units";
import { quoteProblemText, SwapQuoteError } from "@/lib/swapQuote";
import { holdingVenue } from "@/lib/venues";
import { PLATFORM_LABEL } from "@/components/lite/rwa/VenuePicker";
import { haptic } from "@/lib/haptics";
import { iconBtn } from "./primitives";
import { ReviewSheet } from "./ReviewSheet";
import type { TradeOrder, TradeDraft } from "../LiteApp";

const BPS = BigInt(10000);

const TOL_BPS = [50, 100, 300]; // Tight / Normal / Loose
const TOL_LABELS = ["Tight", "Normal", "Loose"];
const TOL_PCT = ["0.5%", "1%", "3%"];

export function TradeScreen({
  go,
  symbol,
  initialSide = "buy",
  venue: venueProp,
  swap,
  draft,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol: string;
  initialSide?: "buy" | "sell";
  /** BSC only: which issuer this trade uses — the venue picked on AssetDetail for a buy, or the
   *  venue of the holding being sold. Undefined off BSC, and safe to omit (every hook below
   *  ignores it there). */
  venue?: RwaPlatform;
  swap: ReturnType<typeof useSwap>;
  /** Restored form state when a trade bounced back here with an error. */
  draft?: TradeDraft;
}) {
  const chain = useChain();
  const bsc = chain.key === "bsc";
  // Design critique P1 #9: "Buy from Ondo instead" switches the issuer right here, without a
  // trip back to Asset detail. The prop is where the trade started; this is where it is now.
  const [venueOverride, setVenueOverride] = useState<RwaPlatform | undefined>(undefined);
  const venue = venueOverride ?? venueProp;
  const asset: Asset = chain.assets.all.find((a) => a.symbol === symbol) ?? chain.assets.all[0];
  const d = displayFor(asset.symbol, asset.name);
  const ticker = d.ticker ?? asset.symbol;
  const decimals = asset.decimals ?? 18;
  // Sellable = anything with a validated swap route on this chain. `coming`
  // assets (no liquid market yet) are never buyable or sellable.
  const coming = Boolean(asset.coming || d.coming);
  const sellable = isRoutable(chain, asset.symbol) && !coming;
  const { priceUsd: livePrice } = usePrice(asset.symbol);
  const { data: dayMarket } = useMarketHistory(asset.symbol, "1D");
  // Design critique P1 #5: overridden below to the CHOSEN issuer's own price on BSC — the
  // generic oracle price can name a different number than the venue this trade actually uses.
  let shownPrice = livePrice ?? d.price;
  const day = dayMarket?.changePct ?? d.day;
  const up = day >= 0;
  const market = useMarketStatus();
  const closed = asset.tier === "stock" && !bsc && market !== null && !market.open;
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const balance = bal?.value ?? 0;
  // `wantVenue` narrows which row is "the position" when a ticker has two (one per issuer). It
  // must default to the asset's own platform, not "the first row" — the portfolio sorts twin
  // rows by value, so the Ondo twin can be first even when nothing was explicitly picked, and
  // matching on `venue === undefined` there sold the wrong issuer's token under the default
  // label. Off BSC `holdingVenue` returns undefined and every row still matches, so nothing
  // changes there.
  const wantVenue = holdingVenue(chain, asset, venue);
  const holding = port?.holdings.find((h) => h.asset.symbol === asset.symbol && (!bsc || h.venue === wantVenue));
  // Design critique P0 #2 / P1 #5: the BSC closed line and the "Buying from" price both read off
  // THIS venue — the one the trade actually uses — never the generic NYSE calendar `market`
  // above, which was reporting "closed" during Ondo's overnight session and staying silent
  // while bStock alone was paused.
  const rwaTicker = useRwaTicker(asset.symbol);
  const tradeVenueView = bsc ? rwaTicker?.venues.find((v) => v.platform === wantVenue) : undefined;
  if (bsc && tradeVenueView) shownPrice = tradeVenueView.tokenPrice;
  // Design critique P0 #1 reviewer follow-up: swap-quote's 409 text ("NVDA is closed right now;
  // it opens Mon 9:30am ET") is deliberately server-side and ET-labelled — it stays readable on
  // its own (server logs, a caller with no client formatter). Once the RWA catalog has ALREADY
  // told this screen the venue isn't buyable, the local-time closed line below is telling the
  // same story in the viewer's own clock; showing the raw quote error underneath it too just
  // repeated the fact in a second, worse-labelled clock right below the first.
  const venueKnownClosed = bsc && Boolean(tradeVenueView) && !tradeVenueView!.buyable;
  // The other issuer of the same share, when this one is closed and that one is open right now.
  const switchTo = bsc ? otherOpenVenue(wantVenue, rwaTicker?.venues) : undefined;
  const otherVenueView = bsc ? rwaTicker?.venues.find((v) => v.platform !== wantVenue) : undefined;
  // Design critique P0 #3: what a failed quote says, in plain words naming the company and the
  // issuer — server and Binance text never reaches the banner (lib/swapQuote.ts quoteProblemText).
  const problemCtx = (s: "buy" | "sell") => ({
    bsc,
    companyName: d.name,
    issuer: wantVenue ? PLATFORM_LABEL[wantVenue] : undefined,
    otherIssuer: otherVenueView?.buyable ? PLATFORM_LABEL[otherVenueView.platform] : undefined,
    side: s,
  });

  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  // The amount is the shared keypad state: one rule set, and the cash on hand is
  // its ceiling — a digit that would spend money you don't have is refused, not
  // typed and then complained about. The ceiling only applies once the balance
  // has actually loaded, or an empty first render would refuse every key.
  const pad = useAmountKeypad({ max: bal ? balance : undefined, initial: draft?.amt });
  const amt = pad.value;
  const setAmt = pad.setValue;
  const [tol, setTol] = useState(draft?.tol ?? 1);
  const [advanced, setAdvanced] = useState(false);
  const [review, setReview] = useState(false);

  const n = pad.amount;
  const {
    data: quote,
    isFetching,
    error: quoteError,
  } = useQuote(side === "buy" ? asset : null, n, bsc ? venue : undefined);
  // Review Focus #1 / #3: a refused quote (market closed, below the $6 minimum) must read as a
  // real message, not a blank amount — swap-quote's own text, surfaced verbatim. Except when the
  // catalog already named this venue closed above (`venueKnownClosed`): that quote error is the
  // same closed-market refusal, in a second, ET-labelled sentence right under the first.
  const quoteErrorText = venueKnownClosed ? undefined : quoteProblemText(quoteError, problemCtx("buy"));

  // Sell side: share of the held position to sell. No default — "All" is a chip.
  const [sellPct, setSellPct] = useState(draft?.sellPct ?? 0);
  const heldRaw = holding?.raw ?? BigInt(0);
  const sellRaw = (heldRaw * BigInt(Math.round(sellPct))) / BigInt(100);
  const sellQty = holding ? fromUnits(sellRaw, decimals) : 0;
  const {
    data: sellQuote,
    isFetching: sellFetching,
    error: sellQuoteError,
  } = useSellQuote(side === "sell" && sellable ? asset : null, side === "sell" ? sellRaw : BigInt(0), bsc ? venue : undefined);
  const sellQuoteErrorText = venueKnownClosed ? undefined : quoteProblemText(sellQuoteError, problemCtx("sell"));

  const over = side === "buy" && n > balance + 1e-6;
  // What the line under the amount says. `over` is a value that no longer fits
  // (a restored draft); `pad.refused` is a key the ceiling just turned down —
  // the amount itself is still legal, so this must not gate the button.
  const overNote = over || (side === "buy" && pad.refused);
  const canBuy =
    side === "buy" && !coming && n > 0 && !over && !!quote && !quoteError && quote.expectedOutRaw > BigInt(0) && !!address;
  const canSell =
    side === "sell" &&
    sellable &&
    sellRaw > BigInt(0) &&
    !!sellQuote &&
    !sellQuoteError &&
    sellQuote.expectedUsdcRaw > BigInt(0) &&
    !!address;

  // Buy: the quote is for the gross amount; the fee comes off first, so the
  // shares you actually get are scaled to the net (mirrors useSwap.buy).
  // BSC is fee-free (ADR-0007) — feeUsd/feeOf already zero out for chain.key === "bsc".
  const fee = side === "buy" ? feeUsd(n, chain.key) : 0;
  let netOutRaw = BigInt(0);
  if (quote && n > 0) {
    const amountIn = usdToRaw(chain, n);
    const netIn = amountIn - feeOf(amountIn, chain.key);
    netOutRaw = amountIn > BigInt(0) ? (quote.expectedOutRaw * netIn) / amountIn : BigInt(0);
  }
  const unit = asset.tier === "stock" ? "shares" : ticker;

  // The dryrun stream attaches `dryRun?: DryRun` to the quote once /api/swap-quote runs a
  // Binance simulate before signing; `Quote` doesn't declare the field yet, so this reads it
  // defensively and renders nothing until it actually shows up (never claims a check that
  // didn't run — lib/plainCopy.ts's `dryRunLine` is the single render decision, tested on its
  // own). BSC only: off BSC there's no Binance simulate to report.
  const dryRun = (quote as (typeof quote & { dryRun?: DryRun }) | undefined)?.dryRun;
  const dryRunInfo = bsc ? dryRunLine(dryRun, tokenQty(netOutRaw, decimals), unit) : ({ kind: "none" } as const);
  const dryRunBlocking = dryRunInfo.kind === "blocking";

  const order: TradeOrder | null =
    side === "buy" && canBuy && !dryRunBlocking && quote
      ? {
          side: "buy",
          symbol: asset.symbol,
          name: d.name,
          ticker,
          unit,
          qty: tokenQty(netOutRaw, decimals),
          priceUsd: quote.pricePerToken,
          feeUsd: fee,
          amountUsd: n,
          // Receipt's "Buy more" reopens Trade on the same issuer (design critique P1 #9).
          ...(bsc && venue ? { venue } : {}),
        }
      : side === "sell" && canSell && sellQuote
        ? {
            side: "sell",
            symbol: asset.symbol,
            name: d.name,
            ticker,
            unit,
            qty: tokenQty(sellRaw, decimals),
            priceUsd: sellQty > 0 ? sellQuote.expectedUsd / sellQty : 0,
            feeUsd: 0,
            amountUsd: sellQuote.expectedUsd,
          }
        : null;

  // Hold-to-confirm completed: fire the real swap and move to Placing. LiteApp
  // watches swap.phase from there and routes to the receipt (or back here).
  const confirm = () => {
    if (!order || !address) return;
    haptic.medium();
    const nextDraft: TradeDraft = { amt, sellPct, tol };
    if (order.side === "buy") {
      if (!quote) return;
      void swap.buy({
        asset,
        amountUsd: n,
        expectedOutRaw: quote.expectedOutRaw,
        slippageBps: TOL_BPS[tol],
        recipient: address,
        venue: bsc ? venue : undefined,
      });
    } else {
      if (!sellQuote) return;
      const minUsdcOut = (sellQuote.expectedUsdcRaw * (BPS - BigInt(TOL_BPS[tol]))) / BPS;
      void swap.sell({
        asset,
        amountIn: sellRaw,
        minUsdcOut,
        estUsdcValue: sellQuote.expectedUsd,
        recipient: address,
        slippageBps: TOL_BPS[tol],
        venue: bsc ? venue : undefined,
      });
    }
    setReview(false);
    go("placing", { kind: "trade", order, draft: nextDraft });
  };

  const sellEmpty = side === "sell" && (!sellable || !holding || heldRaw <= BigInt(0));
  const canReview = side === "buy" ? canBuy && !dryRunBlocking : canSell;
  // Design critique P1 #11: only a trade that was SUBMITTED and reverted is an error — a refused
  // quote (market closed, below the $6 minimum) or a failed dry run is a normal state the person
  // can act on, so it never borrows the red banner (`isRealError` below decides the styling).
  const quoteRefusalText = side === "buy" ? (quoteErrorText ?? (dryRunBlocking ? dryRunInfo.text : undefined)) : sellQuoteErrorText;
  // A swap that failed at its build-time quote carries the same SwapQuoteError: same plain words.
  const swapErrorText =
    swap.errorCause instanceof SwapQuoteError ? quoteProblemText(swap.errorCause, problemCtx(side)) : swap.error;
  const bannerError = swapErrorText ?? quoteRefusalText;
  const isRealError = Boolean(swap.error);

  // Every amount change clears a stale swap error along with it, so the screen
  // never shows a failure for a trade the person has already edited away.
  const onAmount = (next: string) => {
    setAmt(next);
    if (swap.error) swap.reset();
  };

  // Which issuer this trade uses, in words — Review Focus and the manual-trade spec both want
  // the person to see who they're actually buying from/selling to, not just a silent address.
  // Same default as the holding lookup, so "via bStock/Ondo" shows even when no venue was
  // explicitly passed (the common case — see the LiteApp follow-up in the review this fixed).
  const venueLabel = wantVenue ? PLATFORM_LABEL[wantVenue] : undefined;

  // The primary action, rendered inside the keypad frame on buy and pinned at
  // the bottom on sell. Same markup either way.
  const action = (
    <>
      <div
        className="tnum"
        // --ink-3 measured 2.31:1 here (design critique P1 #7) — this line states the fee and
        // the issuer, not decoration, so it gets --ink-2, DESIGN.md's floor for anything read.
        style={{ textAlign: "center", marginBottom: 12, fontSize: 12.5, color: "var(--ink-2)" }}
      >
        {side === "sell" || chain.key === "bsc"
          ? "No fee · no network cost"
          : `${n > 0 ? usd(fee) : usd(feeUsd(100))} fee · no network cost`}
        {venueLabel ? ` · via ${venueLabel}` : ""}
      </div>
      {dryRunInfo.kind === "quiet" && (
        <p role="status" className="tnum" style={{ margin: "0 0 12px", textAlign: "center", fontSize: 12.5, color: "var(--ink-2)" }}>
          {dryRunInfo.text}
        </p>
      )}
      <button
        className="btn btn-primary btn-block btn-lg tap"
        disabled={!canReview || swap.busy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          haptic.light();
          setReview(true);
        }}
      >
        {side === "buy" ? `Review buy${n ? ` · ${usd(n)}` : ""}` : "Review sell"}
      </button>
    </>
  );

  const tolerance = (
    <div style={{ padding: "14px 22px 0" }}>
      <div className="card" style={{ padding: "4px 16px" }}>
        <button
          type="button"
          className="tap"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 0",
            background: "none",
            textAlign: "left",
          }}
        >
          <Icon name="sliders" size={17} style={{ color: "var(--ink-3)" }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>Advanced</span>
          <span style={{ flex: 1, fontSize: 13, color: "var(--ink-2)", textAlign: "right" }}>
            Up to {TOL_PCT[tol]} price movement
          </span>
          <Icon
            name="chevD"
            size={16}
            style={{
              color: "var(--ink-3)",
              transform: advanced ? "rotate(180deg)" : "none",
              transition: "transform .26s var(--ease-out)",
            }}
          />
        </button>
        {advanced && (
          <div style={{ padding: "0 0 14px" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {TOL_LABELS.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    haptic.select();
                    setTol(i);
                  }}
                  className={`chip tap ${tol === i ? "is-dark" : ""}`}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {t} · {TOL_PCT[i]}
                </button>
              ))}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-3)" }}>
              If the price moves more than this while your order goes through, it is cancelled and nothing is
              charged.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    // The keypad is the last child and docks itself; it must sit flush with the
    // bottom edge, so the buy screen gives up the tail padding.
    <div className="screen screen-pad-top" style={{ paddingBottom: side === "buy" && !sellEmpty ? 0 : 20 }}>
      {/* one-line header: back · tile · name · price · change */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <AssetTile asset={d} size={32} />
        <h1
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: "-.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {d.name}
        </h1>
        <span className="tnum" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em" }}>
          {shownPrice !== undefined ? usd(shownPrice) : "—"}
        </span>
        <span
          className="tnum"
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 99,
            color: up ? "var(--pos)" : "var(--neg)",
            background: up ? "var(--primary-soft)" : "color-mix(in srgb, var(--neg) 14%, transparent)",
          }}
        >
          {(up ? "+" : "") + day.toFixed(2)}%
        </span>
      </div>

      {/* Design critique P1 #5: name the issuer AND its price right under the header, so a pick
          made on Asset detail is never silently different from what this screen is about to buy. */}
      {bsc && side === "buy" && venueLabel && tradeVenueView && (
        <div className="tnum" style={{ padding: "4px 22px 0", fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-2)" }}>
          Buying from {venueLabel} · {usd(tradeVenueView.tokenPrice)} a token
          {/* Design critique P1 #9: what that price means against the real share, right here. */}
          {gapSentence(tradeVenueView.gapPct, tradeVenueView.referencePrice) && (
            <div>{gapSentence(tradeVenueView.gapPct, tradeVenueView.referencePrice)}</div>
          )}
        </div>
      )}

      {/* Design critique P0 #2: on BSC this line used to come from the generic NYSE calendar,
          which called Ondo's overnight session "closed" and stayed silent through a bStock-only
          pause — it now reads the CHOSEN issuer's own state, the same one the quote itself
          refuses against, so the words and the button never disagree. */}
      {bsc && tradeVenueView && !tradeVenueView.buyable ? (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 22px 0", fontSize: 12.5, color: "var(--ink-2)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--ink-3)", flex: "none" }} />
          {stateLabel({
            state: tradeVenueView.state,
            buyable: tradeVenueView.buyable,
            nextOpenMs: tradeVenueView.nextOpenMs,
            platformLabel: venueLabel,
          })}
          {/* Reviewer follow-up on design critique P1 #8: `nextOpenMs` is never null for ANY
              non-buyable row (rwaCatalog.ts's `buildVenue` always fills it in, even for a pause
              or a ticker Binance doesn't support), so this used to promise "you can buy or sell
              then" at a mid-session pause's next REGULAR open — a reopen time nobody promised,
              and one Binance not supporting a ticker at all has no relationship to whatsoever.
              Only a session-clock state (closed / premarket / postmarket / overnight) actually
              resolves when that instant passes. */}
          {tradeVenueView.state !== "paused" && tradeVenueView.state !== "unsupported" && tradeVenueView.nextOpenMs !== null
            ? ". You can buy or sell then."
            : ""}
        </div>
      ) : (
        closed &&
        market && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 22px 0",
              fontSize: 12.5,
              color: "var(--ink-2)",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--ink-3)", flex: "none" }} />
            Market closed · price can drift until {describeNextChange(market).replace(/^opens /, "")}
          </div>
        )
      )}

      {/* Design critique P1 #9: this issuer is closed but the other one is open — one tap moves
          the buy there instead of a dead end. Secondary (ghost): Review stays the main action. */}
      {side === "buy" && switchTo && (
        <div style={{ padding: "10px 22px 0" }}>
          <button
            type="button"
            className="btn btn-ghost btn-block tap"
            style={{ minHeight: 44, fontSize: 14.5 }}
            onClick={() => {
              haptic.select();
              setVenueOverride(switchTo);
              if (swap.error) swap.reset();
            }}
          >
            Buy from {PLATFORM_LABEL[switchTo]} instead · open now
          </button>
        </div>
      )}

      {/* buy/sell toggle */}
      <div style={{ padding: "14px 22px 0" }}>
        <div className="seg">
          <span
            className="seg-thumb"
            style={{
              width: "calc((100% - 8px) / 2)",
              left: 4,
              transform: `translateX(${side === "sell" ? "100%" : "0"})`,
            }}
          />
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                haptic.select();
                setSide(s);
                if (swap.error) swap.reset();
              }}
              className={`seg-item ${side === s ? "is-on" : ""}`}
              aria-label={s === "buy" ? "Buy" : "Sell"}
              style={{ textTransform: "capitalize" }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {sellEmpty ? (
        <div style={{ padding: "40px 30px 0", textAlign: "center", color: "var(--ink-2)" }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              background: "var(--surface-2)",
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
              margin: "0 auto 16px",
            }}
          >
            <Icon name="clock" size={28} />
          </div>
          <div style={{ fontSize: 16.5, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
            {!holding || heldRaw <= BigInt(0) ? "Nothing to sell here" : "Selling is coming soon"}
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55 }}>
            {!holding || heldRaw <= BigInt(0)
              ? "You don't own this yet. Buy some first, then you can sell any time."
              : "One-tap selling for this asset is on the way. For now, ask Vera to rebuild your plan."}
          </p>
        </div>
      ) : side === "sell" ? (
        <>
          {/* sell amount — what you'd get for the chosen share of your position */}
          <div style={{ padding: "26px 22px 0", textAlign: "center" }}>
            <div
              className="tnum"
              style={{
                fontSize: 50,
                fontWeight: 700,
                letterSpacing: "-.04em",
                color: sellRaw > BigInt(0) ? "var(--ink)" : "var(--ink-3)",
              }}
            >
              {sellRaw <= BigInt(0)
                ? "$0"
                : sellFetching && !sellQuote
                  ? "…"
                  : sellQuote
                    ? usd(sellQuote.expectedUsd)
                    : "—"}
            </div>
            <div className="tnum" style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 4 }}>
              {sellRaw > BigInt(0)
                ? `Selling ${tokenQty(sellRaw, decimals)} ${ticker}`
                : "Pick how much to sell"}
            </div>
            <div className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
              {`You own ${tokenQty(heldRaw, decimals)} ${ticker}`}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, padding: "18px 22px 0", justifyContent: "center" }}>
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                className={`chip tap ${sellPct === p ? "is-dark" : ""}`}
                onClick={() => {
                  haptic.select();
                  setSellPct(p);
                  if (swap.error) swap.reset();
                }}
              >
                {p === 100 ? "All" : `${p}%`}
              </button>
            ))}
          </div>
          {tolerance}
        </>
      ) : (
        <>
          {/* amount — the big number IS the input (tap to type a custom amount) */}
          <div style={{ padding: "26px 22px 0", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline" }}>
              <span
                className="tnum"
                style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-.04em", color: amt ? "var(--ink)" : "var(--ink-3)" }}
              >
                $
              </span>
              <AmountInput
                {...pad.field}
                onChange={onAmount}
                autoFocus
                autoWidth
                aria-label="Amount to buy in dollars"
                aria-invalid={over || undefined}
                aria-describedby="trade-amount-note"
                className="tnum"
                style={{
                  fontSize: 56,
                  fontWeight: 700,
                  letterSpacing: "-.04em",
                  color: amt ? "var(--ink)" : "var(--ink-3)",
                  padding: 0,
                  textAlign: "left",
                }}
              />
            </div>
            <div className="tnum" style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 4 }}>
              {isFetching && !quote
                ? "Getting a live price…"
                : quote && netOutRaw > BigInt(0)
                  ? `≈ ${tokenQty(netOutRaw, decimals)} ${unit}`
                  : shownPrice !== undefined
                    ? `${usd(shownPrice)} each`
                    : ""}
            </div>
            <div
              id="trade-amount-note"
              role={overNote ? "status" : undefined}
              className="tnum"
              style={{ fontSize: 12.5, color: overNote ? "var(--neg)" : "var(--ink-3)", marginTop: 4 }}
            >
              {overNote
                ? `That’s more than the ${usd(balance)} you have`
                : // Design critique P1 #11: say the $6 floor before the person types into it,
                  // not only after a refused quote comes back.
                  bsc && n === 0
                  ? `${usd(balance)} available · Minimum $${BSC_MIN_LEG_USD}`
                  : `${usd(balance)} available`}
            </div>
            {coming && (
              <div role="status" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.5 }}>
                Not buyable on {chain.name} yet: there’s no liquid market for it. We’ll switch it on as soon as there is.
              </div>
            )}
          </div>

          {/* Quick amounts moved into the keypad frame, where they stay reachable
              with the keys up (see the dock at the bottom of this screen). */}
          {tolerance}
        </>
      )}

      {/* One surface for both kinds of failure, styled by what actually happened (design
          critique P1 #11): a submitted trade that reverted (swap.error, dismissable — the
          person edits the form and it clears) is the only one that borrows the red error
          background. A refused quote — market closed, below the $6 minimum, a failed dry run —
          never let them get this far; it's a normal state to react to, not a mistake, so it
          reads on the app's own quiet surface instead. */}
      {bannerError && !sellEmpty && (
        <div style={{ padding: "14px 22px 0" }}>
          <div
            role={swap.error ? "button" : "status"}
            aria-label={swap.error ? "Dismiss error" : undefined}
            onClick={swap.error ? swap.reset : undefined}
            style={{
              background: isRealError ? "color-mix(in srgb, var(--neg) 14%, var(--surface))" : "var(--surface-2)",
              // --neg text on that tint measured ~2.5:1 (design critique P1 #7); --ink is
              // DESIGN.md's floor once a surface carries a color, so the words stay AA.
              color: isRealError ? "var(--ink)" : "var(--ink-2)",
              padding: "11px 14px",
              borderRadius: "var(--rr)",
              fontSize: 13.5,
              fontWeight: 500,
            }}
          >
            {bannerError}
          </div>
        </div>
      )}

      {/* Buy: the action lives inside the keypad frame so it is reachable without
          dismissing the keys. Sell has no amount to type — it is a share of the
          position — so it keeps its own pinned action. */}
      {!sellEmpty && side === "buy" && (
        <Keypad
          {...pad.keypad}
          onChange={onAmount}
          presets={[25, 50, 100]}
          extra={
            <button
              type="button"
              className="chip tap"
              style={{ flex: "none", height: 38 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                haptic.select();
                onAmount(String(Math.floor(balance * 100) / 100));
              }}
            >
              Max
            </button>
          }
          footer={action}
        />
      )}
      {!sellEmpty && side === "sell" && (
        <>
          <div style={{ flex: 1 }} />
          <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>{action}</div>
        </>
      )}

      <ReviewSheet open={review} onClose={() => setReview(false)} onConfirm={confirm} order={order} tile={d} />
    </div>
  );
}
