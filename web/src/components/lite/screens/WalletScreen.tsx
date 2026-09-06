"use client";

// Wallet — the account's money in one place: total balance, Add money (Coinbase
// Onramp, card/bank → USDC on Base) with Cash out beside it, quick Send / Receive
// / Buy, spendable cash (USDC), holdings (live price · qty · value), and the full
// incoming/outgoing transaction history. Receive is an in-place sheet (QR +
// address); each transaction opens a detail sheet with an explorer link.
//
// Add money is env-gated (NEXT_PUBLIC_CDP_PROJECT_ID): unset → the button opens
// the Receive sheet, so the screen never shows a dead primary. On a chain Coinbase
// can't deliver to (Mantle) the sheet says so and points at Receive.
//
// Receive on Base is the three-way chooser (components/lite/receive, docs/RECEIVE.md):
// from another wallet, add cash, or from any network. Mantle keeps the plain
// address + QR sheet.
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { usePrivy } from "@privy-io/react-auth";
import { useUsdcBalance, usePortfolio, type Holding } from "@/hooks/useBalances";
import { useTransactions } from "@/hooks/useTransactions";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { Icon, type IconName, HoldingRow, CountUp, SectionTitle, BottomSheet, useToast } from "@/components/design";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd, tokenQty, shortAddress, txUrl } from "@/lib/format";
import { useChain } from "@/lib/chains/active";
import { haptic } from "@/lib/haptics";
import { ONRAMP_PRESETS, offrampUrl, onrampEnabled, onrampSupported, onrampUrl } from "@/lib/onramp";
import type { WalletTx } from "@/lib/walletTx";
import { iconBtn, Spinner, Pager } from "./primitives";
import { ReceiveSheet } from "@/components/lite/receive";

const DOTS = "••••••";

function relTime(sec?: number): string {
  if (!sec) return "";
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtAmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function Action({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card tap"
      style={{ flex: 1, padding: "16px 8px 13px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, textAlign: "center" }}
    >
      <span style={{ width: 42, height: 42, borderRadius: 99, display: "grid", placeItems: "center", background: "var(--primary)", color: "var(--primary-ink)" }}>
        <Icon name={icon} size={20} stroke={2.2} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.01em" }}>{label}</span>
    </button>
  );
}

export function WalletScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { address, loading: addrLoading } = useSmartAccount();
  const chain = useChain();
  const { user } = usePrivy();
  const { data: bal, isLoading: balLoading } = useUsdcBalance(address ?? undefined);
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);
  const { data: txs, isLoading: txLoading } = useTransactions(address ?? undefined);
  const { notify } = useToast();
  const [hide, setHide] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addAmt, setAddAmt] = useState<number | "custom">(50);
  const [customAmt, setCustomAmt] = useState("");
  const [tx, setTx] = useState<WalletTx | null>(null);
  const [txPage, setTxPage] = useState(0);

  // Add money: Coinbase Onramp when configured and the chain is supported;
  // otherwise the button is the Receive flow (never a dead primary).
  const rampOn = onrampEnabled();
  const rampHere = rampOn && onrampSupported(chain);
  const addAmount = addAmt === "custom" ? Math.floor(parseFloat(customAmt) || 0) : addAmt;
  const rampParams = address
    ? { chain, address, amountUsd: addAmount, partnerUserRef: user?.id }
    : undefined;
  const buyUrl = rampHere && rampParams ? onrampUrl(rampParams) : undefined;
  const sellUrl = rampHere && rampParams ? offrampUrl({ ...rampParams, amountUsd: undefined }) : undefined;

  const openAddMoney = () => {
    haptic.light();
    if (!rampOn) {
      setReceiveOpen(true);
      return;
    }
    setAddOpen(true);
  };
  const continueToCoinbase = () => {
    if (!buyUrl) return;
    haptic.light();
    window.open(buyUrl, "_blank", "noopener");
    setAddOpen(false);
  };
  const cashOut = () => {
    if (!sellUrl) return;
    haptic.light();
    window.open(sellUrl, "_blank", "noopener");
  };

  const cash = bal?.value ?? 0;
  const holdings: Holding[] = port?.holdings ?? [];
  const invested = port?.investedUsd ?? 0;
  const total = cash + invested;

  // Transactions, 10 per page.
  const txList = txs ?? [];
  const txPageCount = Math.max(1, Math.ceil(txList.length / 10));
  const txSafePage = Math.min(txPage, txPageCount - 1);
  const txRows = txList.slice(txSafePage * 10, txSafePage * 10 + 10);

  const loading = balLoading || portLoading;
  const balLen = usd(total).length;
  const balSize = balLen <= 9 ? 50 : balLen <= 11 ? 42 : 36;

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      haptic.light();
      notify("Address copied", "check");
    } catch {
      /* clipboard may be unavailable; the QR + visible address still work */
    }
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 48 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Wallet</h1>
        <button
          onClick={() => setHide((v) => !v)}
          className="tap"
          aria-label={hide ? "Show balances" : "Hide balances"}
          style={{ ...iconBtn, marginLeft: "auto", color: hide ? "var(--primary)" : "var(--ink-2)" }}
        >
          <Icon name="eye" size={19} stroke={hide ? 2.4 : 1.8} />
        </button>
      </div>

      {/* balance hero */}
      <div className="anim-rise" style={{ padding: "18px 22px 6px", position: "relative" }}>
        <span
          aria-hidden
          style={{ position: "absolute", left: 0, top: 8, width: 300, height: 160, background: "radial-gradient(58% 58% at 26% 46%, color-mix(in srgb, var(--primary) 24%, transparent), transparent 72%)", filter: "blur(6px)", pointerEvents: "none", zIndex: 0 }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="label-eyebrow">Total balance</div>
          <div style={{ marginTop: 8, minHeight: 50 }}>
            {loading ? (
              <div className="skeleton" style={{ width: 180, height: 44, borderRadius: 14, marginTop: 4 }} />
            ) : (
              <div className="tnum" style={{ fontSize: balSize, fontWeight: 700, letterSpacing: "-.045em", lineHeight: 0.96 }}>
                {hide ? <span style={{ letterSpacing: ".06em" }}>{DOTS}</span> : <CountUp to={total} />}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
              Cash <b className="tnum" style={{ color: "var(--ink)" }}>{hide ? DOTS : usd(cash)}</b>
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
              Invested <b className="tnum" style={{ color: "var(--ink)" }}>{hide ? DOTS : usd(invested)}</b>
            </span>
          </div>
        </div>
      </div>

      {/* the one obvious action: put money in. Cash out sits beside it as the
          quiet reverse, only when Coinbase can actually do it on this chain. */}
      <div style={{ display: "flex", gap: 10, padding: "14px 22px 0" }}>
        <button
          type="button"
          className="btn btn-primary tap"
          onClick={openAddMoney}
          style={{ flex: 1, height: 52, fontSize: 16 }}
        >
          <Icon name="plus" size={19} stroke={2.4} />
          Add money
        </button>
        {sellUrl && (
          <button
            type="button"
            className="btn btn-ghost tap"
            onClick={cashOut}
            aria-label="Cash out with Coinbase (opens in a new tab)"
            style={{ flex: "none", height: 52, padding: "0 18px", fontSize: 15 }}
          >
            Cash out
          </button>
        )}
      </div>

      {/* quick actions */}
      <div style={{ display: "flex", gap: 10, padding: "12px 22px 0" }}>
        <Action icon="arrowUR" label="Send" onClick={() => go("send")} />
        <Action icon="arrowDR" label="Receive" onClick={() => { haptic.light(); setReceiveOpen(true); }} />
        <Action icon="trend" label="Invest" onClick={() => go("market")} />
      </div>

      {/* cash */}
      <div style={{ padding: "24px 22px 0" }}>
        <SectionTitle>Cash</SectionTitle>
        <button
          className="card row tap"
          onClick={() => go("send", { symbol: "USDC" })}
          style={{ width: "100%", padding: "14px 16px", display: "flex", alignItems: "center", gap: 13, textAlign: "left" }}
        >
          <TokenLogo symbol="USDC" size={38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15.5, letterSpacing: "-.01em" }}>US Dollar</div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>USDC · spendable cash</div>
          </div>
          <div className="tnum" style={{ fontWeight: 700, fontSize: 16 }}>{hide ? DOTS : usd(cash)}</div>
        </button>
      </div>

      {/* holdings */}
      <div style={{ padding: "22px 22px 0" }}>
        <SectionTitle>Holdings</SectionTitle>
        {holdings.length === 0 ? (
          <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>No holdings yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>Invest with Vera or buy an asset to fill your wallet.</div>
          </div>
        ) : (
          <div className="card stagger-in" style={{ padding: "4px 14px" }}>
            {holdings.map((h, i) => {
              const base = toTile(h.asset.symbol, h.asset.name);
              // Real 1D market data replaces the presentational tint when available.
              const tile = { ...base, day: h.dayChangePct ?? base.day, spark: h.spark ?? base.spark };
              const dec = h.asset.decimals ?? 18;
              return (
                <div key={h.asset.symbol} style={{ borderBottom: i < holdings.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                  <HoldingRow
                    asset={tile}
                    sub={catFor(h.asset.symbol, h.asset.name)}
                    showSpark
                    onClick={() => go("asset", { symbol: h.asset.symbol })}
                    right={
                      <div style={{ textAlign: "right" }}>
                        <div className="tnum" style={{ fontWeight: 600, fontSize: 16 }}>
                          {hide ? DOTS : h.valueUsd !== undefined ? usd(h.valueUsd) : "—"}
                        </div>
                        <div className="tnum" style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
                          {hide ? DOTS : `${tokenQty(h.raw, dec)} ${h.asset.symbol}`}
                        </div>
                      </div>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* transactions */}
      <div style={{ padding: "22px 22px 0" }}>
        <SectionTitle>Transactions</SectionTitle>
        {txLoading && !txs ? (
          <div className="card" style={{ padding: "4px 14px" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < 2 ? "1px solid var(--line-2)" : "none" }}>
                <div className="skeleton" style={{ width: 38, height: 38, borderRadius: "50%", flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "46%", height: 13, borderRadius: 6 }} />
                  <div className="skeleton" style={{ width: "34%", height: 11, borderRadius: 6, marginTop: 7 }} />
                </div>
                <div className="skeleton" style={{ width: 64, height: 15, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        ) : !txs || txs.length === 0 ? (
          <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>No transactions yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>Money moving in and out on {chain.name} will show up here.</div>
          </div>
        ) : (
          <div className="card" style={{ padding: "4px 14px" }}>
            {txRows.map((t, i) => {
              const incoming = t.direction === "in";
              return (
                <button
                  key={`${t.hash}-${t.direction}-${txSafePage}-${i}`}
                  className="row tap"
                  onClick={() => setTx(t)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", textAlign: "left", borderBottom: i < txRows.length - 1 ? "1px solid var(--line-2)" : "none" }}
                >
                  <div style={{ position: "relative", flex: "none" }}>
                    <TokenLogo symbol={t.symbol} size={38} />
                    <span style={{ position: "absolute", right: -2, bottom: -2, width: 18, height: 18, borderRadius: 99, display: "grid", placeItems: "center", background: incoming ? "var(--primary)" : "var(--surface-2)", color: incoming ? "var(--primary-ink)" : "var(--ink-2)", boxShadow: "0 0 0 2px var(--surface)" }}>
                      <Icon name={incoming ? "arrowDR" : "arrowUR"} size={11} stroke={2.6} />
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{incoming ? "Received" : "Sent"} {t.symbol}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                      {shortAddress(t.counterparty)}{t.timestamp ? ` · ${relTime(t.timestamp)}` : ""}
                    </div>
                  </div>
                  <div className="tnum" style={{ fontWeight: 700, fontSize: 15, color: incoming ? "var(--primary)" : "var(--ink)" }}>
                    {incoming ? "+" : "−"}{hide ? DOTS : fmtAmt(t.amount)} {t.symbol}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {txList.length > 10 && <Pager page={txSafePage} pageCount={txPageCount} onPage={setTxPage} />}
      </div>

      {/* add money sheet — presets, then off to Coinbase in a new tab */}
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title="Add money">
        {rampHere ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "2px 2px 8px" }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Pay with a card or bank through Coinbase. It lands in your account as US dollars on {chain.name},
              usually within a few minutes.
            </p>
            <div role="radiogroup" aria-label="Amount" style={{ display: "flex", gap: 8 }}>
              {ONRAMP_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={addAmt === p}
                  onClick={() => { haptic.select(); setAddAmt(p); }}
                  className={`chip tap ${addAmt === p ? "is-dark" : ""}`}
                  style={{ flex: 1, justifyContent: "center", height: 44, fontSize: 15, fontWeight: 600 }}
                >
                  ${p}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={addAmt === "custom"}
                onClick={() => { haptic.select(); setAddAmt("custom"); }}
                className={`chip tap ${addAmt === "custom" ? "is-dark" : ""}`}
                style={{ flex: 1, justifyContent: "center", height: 44, fontSize: 15, fontWeight: 600 }}
              >
                Custom
              </button>
            </div>
            {addAmt === "custom" && (
              <div className="field" style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", height: 52 }}>
                <span className="tnum" style={{ fontSize: 18, fontWeight: 700, color: customAmt ? "var(--ink)" : "var(--ink-3)" }}>$</span>
                <input
                  inputMode="numeric"
                  autoFocus
                  placeholder="0"
                  value={customAmt}
                  onChange={(e) => setCustomAmt(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  aria-label="Amount to add in dollars"
                  className="tnum"
                  style={{ flex: 1, fontSize: 18, fontWeight: 700, background: "transparent", border: "none", outline: "none", padding: 0 }}
                />
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary btn-block tap"
              disabled={!buyUrl || addAmount <= 0}
              onClick={continueToCoinbase}
              style={{ height: 52 }}
            >
              {addAmount > 0 ? `Add ${usd(addAmount).replace(/\.00$/, "")} with Coinbase` : "Enter an amount"}
              <Icon name="arrowUR" size={16} />
            </button>
            <button
              type="button"
              className="tap"
              onClick={() => { setAddOpen(false); setReceiveOpen(true); }}
              style={{ minHeight: 44, fontSize: 14, fontWeight: 600, color: "var(--ink-2)", background: "none" }}
            >
              Or send US dollars from another account
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "2px 2px 8px" }}>
            <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Add money with a card or bank is available on Base. On {chain.name}, send USDC to your address
              instead. It arrives in under a minute.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block tap"
              onClick={() => { setAddOpen(false); setReceiveOpen(true); }}
              style={{ height: 52 }}
            >
              Show my address
            </button>
          </div>
        )}
      </BottomSheet>

      {/* receive sheet — Base gets the chooser; Mantle keeps the plain address + QR */}
      {chain.key === "base" ? (
        <ReceiveSheet
          open={receiveOpen}
          onClose={() => setReceiveOpen(false)}
          recipient={address}
          addCashEnabled={rampHere}
          onAddCash={() => { setReceiveOpen(false); setAddOpen(true); }}
        />
      ) : (
      <BottomSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} title="Receive">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "4px 4px 8px" }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", textAlign: "center", lineHeight: 1.5 }}>
            Send <b style={{ color: "var(--ink)" }}>USDC on {chain.name}</b> to this address. It arrives in under a minute.
          </p>
          {addrLoading || !address ? (
            <div style={{ width: 196, height: 196, display: "grid", placeItems: "center" }}><Spinner /></div>
          ) : (
            <div style={{ padding: 14, background: "#fff", borderRadius: 22, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.06)", lineHeight: 0 }}>
              <QRCodeSVG value={address} size={168} level="M" marginSize={0} bgColor="#ffffff" fgColor="#1c201a" />
            </div>
          )}
          <button onClick={copyAddress} disabled={!address} className="tap" aria-label="Copy address" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px 14px", borderRadius: 14, background: "var(--surface-2)" }}>
            <span className="mono" style={{ fontSize: 14 }}>{address ? `${address.slice(0, 12)}…${address.slice(-8)}` : "…"}</span>
            <Icon name="link" size={17} style={{ color: "var(--ink-2)", flex: "none" }} />
          </button>
          <button onClick={copyAddress} disabled={!address} className="btn btn-primary btn-block tap" style={{ height: 50 }}>Copy address</button>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 14, background: "var(--accent-soft)", color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.5 }}>
            <Icon name="info" size={16} stroke={2} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
            <span>Only send <b style={{ color: "var(--ink)" }}>USDC</b> on the <b style={{ color: "var(--ink)" }}>{chain.name}</b> network. Other tokens or networks may be lost.</span>
          </div>
        </div>
      </BottomSheet>
      )}

      {/* transaction detail sheet */}
      <BottomSheet open={!!tx} onClose={() => setTx(null)} title={tx ? (tx.direction === "in" ? "Received" : "Sent") : undefined}>
        {tx && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "2px 2px 8px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <TokenLogo symbol={tx.symbol} size={56} />
              <div className="tnum" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.03em", color: tx.direction === "in" ? "var(--primary)" : "var(--ink)" }}>
                {tx.direction === "in" ? "+" : "−"}{fmtAmt(tx.amount)} {tx.symbol}
              </div>
            </div>
            <div className="card" style={{ padding: "4px 16px" }}>
              <DetailRow label="Status" value="Confirmed" />
              <DetailRow label={tx.direction === "in" ? "From" : "To"} value={shortAddress(tx.counterparty)} mono borderTop />
              <DetailRow label="Network" value={chain.name} borderTop />
              {tx.timestamp && (
                <DetailRow label="When" value={new Date(tx.timestamp * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} borderTop />
              )}
              <DetailRow label="Transaction" value={`${tx.hash.slice(0, 10)}…${tx.hash.slice(-8)}`} mono borderTop />
            </div>
            <a href={txUrl(tx.hash, chain)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-block tap" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              View on {chain.explorer.name} <Icon name="arrowUR" size={16} />
            </a>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function DetailRow({ label, value, mono, borderTop }: { label: string; value: string; mono?: boolean; borderTop?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 0", borderTop: borderTop ? "1px solid var(--line-2)" : "none" }}>
      <span style={{ fontSize: 14, color: "var(--ink-2)" }}>{label}</span>
      <span className={mono ? "mono" : undefined} style={{ fontSize: 14, fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}
