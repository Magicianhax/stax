"use client";

// "From another wallet": connect an external wallet (MetaMask, Rainbow, a
// WalletConnect app…) and move USDC on Base into the Stax account in one
// confirmation. That wallet signs and pays the network fee itself.
import { useState } from "react";
import { Icon, useToast } from "@/components/design";
import { useExternalWalletTransfer } from "@/hooks/useReceive";
import { haptic } from "@/lib/haptics";
import { usd, shortAddress } from "@/lib/format";
import { ONRAMP_PRESETS } from "@/lib/onramp";
import { Spinner } from "../screens/primitives";
import { SheetHeader } from "./SheetHeader";
import { SheetStep } from "@/components/motion";
import s from "./receive.module.css";

function parseAmount(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.floor(n * 100) / 100 : 0;
}

export function FromWallet({
  recipient,
  onBack,
  onClose,
}: {
  /** The user's Stax account on Base (smart account). */
  recipient: `0x${string}` | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useExternalWalletTransfer();
  const { notify } = useToast();
  const [amountStr, setAmountStr] = useState("");
  const amount = parseAmount(amountStr);
  const busy = t.phase === "switching" || t.phase === "confirming" || t.phase === "sending";
  const balance = t.balance;
  const tooMuch = balance !== undefined && amount > balance + 1e-9;
  const canMove = Boolean(t.walletAddress && recipient) && amount > 0 && !tooMuch && !busy;

  const setPreset = (p: number) => {
    haptic.select();
    setAmountStr(String(p));
  };
  const setMax = () => {
    if (balance === undefined) return;
    haptic.select();
    setAmountStr((Math.floor(balance * 100) / 100).toString());
  };

  const move = async () => {
    if (!recipient || !canMove) return;
    haptic.light();
    const moved = amount;
    if (await t.move(moved, recipient)) {
      notify(`Moved ${usd(moved).replace(/\.00$/, "")} to Stax`, "check");
      setAmountStr("");
    }
  };

  const label =
    t.phase === "switching" ? "Switching to Base…"
    : t.phase === "confirming" ? `Confirm in ${t.walletName ?? "your wallet"}…`
    : t.phase === "sending" ? "Moving…"
    : amount > 0 ? `Move ${usd(amount).replace(/\.00$/, "")} to Stax`
    : "Move to Stax";

  return (
    <>
      <SheetHeader title="From another wallet" onBack={onBack} onClose={onClose} />
      <SheetStep step="wallet" style={{ display: "flex", flexDirection: "column", gap: 14, padding: "2px 0 6px" }}>
        {!t.walletAddress ? (
          <>
            <p style={{ margin: "0 2px", fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Already have USDC in a wallet like MetaMask or Rainbow? Connect it and move dollars to Stax in one step.
            </p>
            <button type="button" className="btn btn-primary btn-block tap" onClick={() => { haptic.light(); t.connect(); }} style={{ height: 52 }}>
              <Icon name="wallet" size={19} stroke={2.2} />
              Connect a wallet
            </button>
            <p style={{ margin: "0 2px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Your other wallet pays the network fee for this one.
            </p>
          </>
        ) : (
          <>
            {/* the connected wallet + its USDC on Base */}
            <div className={s.option} style={{ minHeight: 62, cursor: "default" }} aria-live="polite">
              <span aria-hidden style={{ width: 40, height: 40, borderRadius: 99, flex: "none", display: "grid", placeItems: "center", background: "var(--surface-2)", color: "var(--ink-2)" }}>
                <Icon name="wallet" size={19} stroke={2} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 15, fontWeight: 600, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.walletName ?? "Connected wallet"}
                </span>
                <span className="mono" style={{ display: "block", fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>{shortAddress(t.walletAddress)}</span>
              </span>
              <span style={{ textAlign: "right", flex: "none" }}>
                <span className="tnum" style={{ display: "block", fontSize: 15.5, fontWeight: 700 }}>
                  {t.balanceLoading ? <span className="skeleton" style={{ display: "inline-block", width: 56, height: 15, borderRadius: 6 }} /> : usd(balance ?? 0)}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>USDC on Base</span>
              </span>
            </div>

            {/* amount */}
            <div className="field" style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px 0 16px", height: 56 }}>
              <span className="tnum" style={{ fontSize: 20, fontWeight: 700, color: amountStr ? "var(--ink)" : "var(--ink-3)" }}>$</span>
              <input
                inputMode="decimal"
                placeholder="0"
                value={amountStr}
                disabled={busy}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 10))}
                aria-label="Amount to move in dollars"
                aria-invalid={tooMuch || undefined}
                className="tnum"
                style={{ flex: 1, minWidth: 0, fontSize: 20, fontWeight: 700, padding: 0 }}
              />
              <button
                type="button"
                onClick={setMax}
                disabled={balance === undefined || busy}
                className="tap"
                style={{ minHeight: 40, padding: "0 13px", borderRadius: 11, background: "var(--surface-2)", color: "var(--primary)", fontWeight: 700, fontSize: 13 }}
              >
                Max
              </button>
            </div>
            <div role="group" aria-label="Quick amounts" style={{ display: "flex", gap: 8 }}>
              {ONRAMP_PRESETS.map((p) => {
                const on = amount === p;
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => setPreset(p)}
                    className={`chip tap ${on ? "is-dark" : ""}`}
                    style={{ flex: 1, justifyContent: "center", height: 44, fontSize: 15, fontWeight: 600 }}
                  >
                    ${p}
                  </button>
                );
              })}
            </div>

            {tooMuch && (
              <p role="alert" style={{ margin: "-4px 2px 0", fontSize: 13, color: "var(--neg)", lineHeight: 1.45 }}>
                That&apos;s more than the {usd(balance ?? 0)} in this wallet.
              </p>
            )}
            {t.phase === "error" && t.error && (
              <p role="alert" style={{ margin: "-4px 2px 0", fontSize: 13.5, color: "var(--neg)", lineHeight: 1.45 }}>{t.error}</p>
            )}
            {t.phase === "done" && (
              <p aria-live="polite" style={{ margin: "-4px 2px 0", display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: "var(--primary)" }}>
                <Icon name="check" size={16} stroke={2.6} /> It&apos;s in your Stax account.
              </p>
            )}

            <button type="button" className="btn btn-primary btn-block tap" disabled={!canMove} onClick={move} style={{ height: 52 }} aria-busy={busy || undefined}>
              {busy && <Spinner small />}
              {label}
            </button>
            <p style={{ margin: "0 2px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Your other wallet pays the network fee for this one.
              {t.needsSwitch ? " It will be asked to switch to Base first." : ""}
            </p>
          </>
        )}
      </SheetStep>
    </>
  );
}
