"use client";

// Trade — Pro manual buy/sell (screens_pro.jsx · Trade) wired to the REAL gasless
// path. BUY: useQuote (live Fluxion spot) + useSwap.buy (batched approve +
// exactInputSingle as one sponsored UserOp). SELL: useSellQuote + useSwap.sell
// (the held stock token -> USDC, recipient = user). The slippage tolerance maps
// Tight / Normal / Loose to 50 / 100 / 300 bps (the on-chain amountOutMinimum is
// the real protection). On success we route to the plain-words receipt.
//
// Selling is supported for stock-tier holdings (single-hop Fluxion). Routed
// SAFE/CRYPTO sells aren't wired yet, so they're gated honestly.
import { useEffect, useState } from "react";
import { ALL_ASSETS, STOCKS, type Asset } from "@/lib/mantle";
import { useQuote, useSellQuote } from "@/hooks/useQuote";
import { useSwap } from "@/hooks/useSwap";
import { useUsdcBalance, usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { displayFor } from "@/lib/displayAssets";
import { Icon, AssetTile, Crossfade, PriceChart } from "@/components/design";
import { usd, tokenQty, fromUnits } from "@/lib/format";
import { STAX_FEE_LABEL } from "@/lib/fees";
import { iconBtn, Spinner } from "./primitives";

const BPS = BigInt(10000);

const TOL_BPS = [50, 100, 300]; // Tight / Normal / Loose
const TOL_LABELS = ["Tight", "Normal", "Loose"];
const TOL_PCT = ["0.5%", "1.0%", "3.0%"];

export function TradeScreen({
  go,
  symbol,
  initialSide = "buy",
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol: string;
  initialSide?: "buy" | "sell";
}) {
  const asset: Asset = ALL_ASSETS.find((a) => a.symbol === symbol) ?? ALL_ASSETS[0];
  const d = displayFor(asset.symbol, asset.name);
  const up = d.day >= 0;
  const isStock = STOCKS.some((s) => s.symbol === asset.symbol);
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const balance = bal?.value ?? 0;
  const holding = port?.holdings.find((h) => h.asset.symbol === asset.symbol);

  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [amt, setAmt] = useState("");
  const [tol, setTol] = useState(1);

  const n = parseFloat(amt) || 0;
  const { data: quote, isFetching } = useQuote(side === "buy" ? asset : null, n);
  const swap = useSwap();

  // Sell side: percentage of the held position to sell (default 100%).
  const [sellPct, setSellPct] = useState(100);
  const heldRaw = holding?.raw ?? BigInt(0);
  const sellRaw = (heldRaw * BigInt(Math.round(sellPct))) / BigInt(100);
  const sellQty = holding ? fromUnits(sellRaw, asset.decimals ?? 18) : 0;
  const { data: sellQuote, isFetching: sellFetching } = useSellQuote(
    side === "sell" && isStock ? asset : null,
    side === "sell" ? sellRaw : BigInt(0),
  );

  const over = side === "buy" && n > balance + 1e-6;
  const canBuy =
    side === "buy" && n > 0 && !over && !!quote && quote.expectedOutRaw > BigInt(0) && !!address;
  const canSell =
    side === "sell" &&
    isStock &&
    sellRaw > BigInt(0) &&
    !!sellQuote &&
    sellQuote.expectedUsdcRaw > BigInt(0) &&
    !!address;

  // On a filled buy/sell, jump to the plain-words receipt.
  useEffect(() => {
    if (swap.phase === "done" && swap.result) {
      const isSell = swap.result.side === "sell";
      go("receipt", {
        title: `${isSell ? "Sold" : "Bought"} ${swap.result.asset.name}`,
        amount: isSell ? swap.result.amountUsd : -swap.result.amountUsd,
        txHash: swap.result.txHash,
      });
    }
  }, [swap.phase, swap.result, go]);

  const submit = () => {
    if (side === "buy") {
      if (!quote || !address) return;
      void swap.buy({
        asset,
        amountUsd: n,
        expectedOutRaw: quote.expectedOutRaw,
        slippageBps: TOL_BPS[tol],
        recipient: address,
      });
      return;
    }
    // sell
    if (!sellQuote || !address) return;
    const minUsdcOut =
      (sellQuote.expectedUsdcRaw * (BPS - BigInt(TOL_BPS[tol]))) / BPS;
    void swap.sell({
      asset,
      amountIn: sellRaw,
      minUsdcOut,
      estUsdcValue: sellQuote.expectedUsd,
      recipient: address,
    });
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 4 }}>
          <AssetTile asset={d} size={30} />
          <h1 style={{ margin: 0, fontWeight: 700, fontSize: 17, letterSpacing: "-.01em" }}>{d.name}</h1>
        </div>
      </div>

      {/* price + market context */}
      <div style={{ padding: "12px 22px 0", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span className="tnum" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>
          {d.price !== undefined ? usd(d.price) : "—"}
        </span>
        <span
          className="tnum"
          style={{ fontSize: 13, fontWeight: 700, color: up ? "var(--pos)" : "var(--neg)" }}
        >
          {(up ? "+" : "") + d.day.toFixed(2)}% today
        </span>
      </div>
      <div style={{ padding: "10px 22px 2px" }}>
        <PriceChart
          data={d.spark}
          up={up}
          height={120}
          label={`${d.name} price chart, ${up ? "up" : "down"} ${Math.abs(d.day).toFixed(1)}% today`}
        />
      </div>

      {/* buy/sell toggle — sliding-thumb segmented control */}
      <div style={{ padding: "16px 22px 0" }}>
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
              onClick={() => setSide(s)}
              className={`seg-item ${side === s ? "is-on" : ""}`}
              style={{ textTransform: "capitalize" }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {side === "sell" && (!isStock || !holding || heldRaw <= BigInt(0)) ? (
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
          {/* sell amount */}
          <div style={{ padding: "30px 22px 0", textAlign: "center" }}>
            <div
              className="tnum"
              style={{ fontSize: 50, fontWeight: 700, letterSpacing: "-.04em" }}
            >
              {sellFetching && !sellQuote
                ? "…"
                : sellQuote
                  ? usd(sellQuote.expectedUsd)
                  : "—"}
            </div>
            <div className="tnum" style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 4 }}>
              {`Selling ${tokenQty(sellRaw, asset.decimals ?? 18)} ${d.ticker ?? asset.symbol}`}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
              {`You own ${tokenQty(heldRaw, asset.decimals ?? 18)}`}
            </div>
          </div>

          {/* sell percentage */}
          <div style={{ display: "flex", gap: 8, padding: "18px 22px 0", justifyContent: "center" }}>
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                className={`chip tap ${sellPct === p ? "is-dark" : ""}`}
                onClick={() => setSellPct(p)}
                style={{ height: 38 }}
              >
                {p === 100 ? "All" : `${p}%`}
              </button>
            ))}
          </div>

          {/* tolerance */}
          <div style={{ padding: "18px 22px 0" }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)" }}>
                  Price movement I&apos;ll allow
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {TOL_PCT[tol]}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {TOL_LABELS.map((t, i) => (
                  <button
                    key={t}
                    onClick={() => setTol(i)}
                    className={`chip tap ${tol === i ? "is-dark" : ""}`}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {swap.error && (
            <div style={{ padding: "14px 22px 0" }}>
              <div
                onClick={swap.reset}
                style={{
                  background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
                  color: "var(--neg)",
                  padding: "11px 14px",
                  borderRadius: "var(--rr)",
                  fontSize: 13.5,
                  fontWeight: 500,
                }}
              >
                {swap.error}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />
          <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>
            <div style={{ textAlign: "center", marginBottom: 12, fontSize: 12.5, color: "var(--ink-3)" }}>
              Free · paid into your cash balance
            </div>
            <button
              className="btn btn-primary btn-block btn-lg tap"
              disabled={!canSell || swap.busy}
              onClick={submit}
            >
              <Crossfade
                showFirst={swap.busy}
                style={{ alignItems: "center" }}
                first={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                    <Spinner small /> Securing…
                  </span>
                }
                second={<span>Sell{sellQuote ? ` for ${usd(sellQuote.expectedUsd)}` : ""}</span>}
              />
            </button>
          </div>
        </>
      ) : (
        <>
          {/* amount — the big number IS the input (tap to type a custom amount) */}
          <div style={{ padding: "30px 22px 0", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline" }}>
              <span
                className="tnum"
                style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-.04em", color: amt ? "var(--ink)" : "var(--ink-3)" }}
              >
                $
              </span>
              <input
                inputMode="decimal"
                autoFocus
                placeholder="0"
                value={amt}
                onChange={(e) => {
                  // digits + a single decimal point only
                  const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                  setAmt(v);
                  if (swap.error) swap.reset();
                }}
                aria-label="Amount to buy in dollars"
                className="tnum"
                style={{
                  fontSize: 56,
                  fontWeight: 700,
                  letterSpacing: "-.04em",
                  color: amt ? "var(--ink)" : "var(--ink-3)",
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  padding: 0,
                  textAlign: "left",
                  width: `${Math.max(1, (amt || "0").length)}ch`,
                  caretColor: "var(--primary)",
                }}
              />
            </div>
            <div className="tnum" style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 4 }}>
              {isFetching && !quote
                ? "Getting a live price…"
                : quote && quote.expectedOutRaw > BigInt(0)
                  ? `≈ ${tokenQty(quote.expectedOutRaw, asset.decimals ?? 18)} shares`
                  : d.price !== undefined
                    ? `${usd(d.price)} each`
                    : ""}
            </div>
            <div
              style={{ fontSize: 12.5, color: over ? "var(--neg)" : "var(--ink-2)", marginTop: 4 }}
            >
              {usd(balance)} available
            </div>
          </div>

          {/* quick amounts */}
          <div style={{ display: "flex", gap: 8, padding: "18px 22px 0", justifyContent: "center" }}>
            {[25, 50, 100].map((q) => (
              <button
                key={q}
                className={`chip tap ${amt === String(q) ? "is-dark" : ""}`}
                onClick={() => setAmt(String(q))}
                style={{ height: 38 }}
              >
                ${q}
              </button>
            ))}
            <button
              className="chip tap"
              onClick={() => setAmt(String(Math.floor(balance * 100) / 100))}
              style={{ height: 38 }}
            >
              Max
            </button>
          </div>

          {/* tolerance */}
          <div style={{ padding: "18px 22px 0" }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)" }}>
                  Price movement I&apos;ll allow
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {TOL_PCT[tol]}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {TOL_LABELS.map((t, i) => (
                  <button
                    key={t}
                    onClick={() => setTol(i)}
                    className={`chip tap ${tol === i ? "is-dark" : ""}`}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {swap.error && (
            <div style={{ padding: "14px 22px 0" }}>
              <div
                onClick={swap.reset}
                style={{
                  background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
                  color: "var(--neg)",
                  padding: "11px 14px",
                  borderRadius: "var(--rr)",
                  fontSize: 13.5,
                  fontWeight: 500,
                }}
              >
                {swap.error}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />
          <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>
            <div style={{ textAlign: "center", marginBottom: 12, fontSize: 12.5, color: "var(--ink-3)" }}>
              Gas-free · {STAX_FEE_LABEL} fee
            </div>
            <button
              className="btn btn-primary btn-block btn-lg tap"
              disabled={!canBuy || swap.busy}
              onClick={submit}
            >
              <Crossfade
                showFirst={swap.busy}
                style={{ alignItems: "center" }}
                first={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                    <Spinner small /> Securing…
                  </span>
                }
                second={<span>Buy {n ? usd(n) : ""}</span>}
              />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
