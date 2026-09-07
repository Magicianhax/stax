"use client";

// Send — move USDC or any held token out of the smart account to an address on
// the active network (Base / Mantle). Pick an asset, enter amount + recipient, confirm, and it goes as one
// gasless transfer (useTransfer). Real funds: address is validated, amount is
// capped to the balance, and a confirm step guards against accidental sends.
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isAddress, parseUnits } from "viem";
import { useUsdcBalance, usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useTransfer } from "@/hooks/useTransfer";
import { Icon, AmountInput, Keypad } from "@/components/design";
import { useAmountKeypad, toAmountString } from "@/hooks/useAmountKeypad";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { useChain } from "@/lib/chains/active";
import { usd, tokenQty, fromUnits, shortAddress, txUrl } from "@/lib/format";
import { iconBtn, Spinner } from "./primitives";

interface Sendable {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  raw: bigint;
  priceUsd?: number; // USD per whole token (USDC = 1)
}

export function SendScreen({
  go,
  symbol: initialSymbol,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol?: string;
}) {
  const { address } = useSmartAccount();
  const chain = useChain();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const transfer = useTransfer();

  // Sendable assets: cash (USDC) first, then every held token.
  const assets: Sendable[] = useMemo(() => {
    const cash: Sendable = {
      symbol: "USDC",
      name: "US Dollar",
      address: chain.usdc.address,
      decimals: chain.usdc.decimals,
      raw: bal?.raw ?? BigInt(0),
      priceUsd: 1,
    };
    const held = (port?.holdings ?? [])
      .filter((h) => h.asset.address && h.asset.decimals)
      .map((h) => ({
        symbol: h.asset.symbol,
        name: h.asset.name,
        address: h.asset.address as `0x${string}`,
        decimals: h.asset.decimals as number,
        raw: h.raw,
        priceUsd: h.priceUsd,
      }));
    return [cash, ...held];
  }, [bal?.raw, port?.holdings, chain]);

  const [sel, setSel] = useState(() => {
    const i = assets.findIndex((a) => a.symbol === initialSymbol);
    return i >= 0 ? i : 0;
  });
  const asset = assets[Math.min(sel, assets.length - 1)];

  // Amount entry is the shared keypad: same rules everywhere, and the token's
  // own balance is the ceiling. Token decimals are capped at 6 for entry — no
  // one types eighteen places, and the raw amount is parsed from the string.
  const entryDecimals = Math.min(asset.decimals, 6);
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  // The pad shares the bottom edge with the address field's own OS keyboard, so
  // it is up only while the amount has focus.
  const [padOpen, setPadOpen] = useState(false);

  // Paste: reads the clipboard when the browser allows it (secure context +
  // permission). Hidden where readText doesn't exist; a denied read just puts
  // the caret in the field so the user can paste by hand.
  const toRef = useRef<HTMLInputElement>(null);
  const canPaste = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.clipboard?.readText === "function",
    () => false,
  );
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setTo(text);
        setConfirming(false);
        return;
      }
    } catch {
      /* permission denied or unavailable — fall through */
    }
    toRef.current?.focus();
  };

  const balanceNum = fromUnits(asset.raw, asset.decimals);
  const pad = useAmountKeypad({
    // No ceiling until there is a balance to measure against, or the first
    // render (before the balance query lands) would refuse every key.
    max: balanceNum > 0 ? balanceNum : undefined,
    decimals: entryDecimals,
  });
  const amount = pad.value;
  const amountNum = pad.amount;
  const amountRaw = (() => {
    try {
      return amount ? parseUnits(amount, asset.decimals) : BigInt(0);
    } catch {
      return BigInt(0);
    }
  })();
  const usdValue = asset.priceUsd !== undefined ? amountNum * asset.priceUsd : undefined;

  const addrValid = isAddress(to.trim());
  // Only complain once there's something address-shaped to judge.
  const addrError = to.trim().length >= 6 && !addrValid;
  const overBalance = amountRaw > asset.raw;
  // The keypad refuses a key that would spend more than the balance; the note
  // explains the silence. It never gates the button — the amount is still legal.
  const overNote = overBalance || pad.refused;
  const canReview = amountRaw > BigInt(0) && !overBalance && addrValid;

  // Editing the amount reopens the form: a confirm step that survived an edit
  // would be confirming a number the person has already changed.
  const onAmount = (next: string) => { pad.setValue(next); setConfirming(false); };

  const setMax = () => pad.setValue(toAmountString(balanceNum, { decimals: entryDecimals }));

  const onSend = () => {
    void transfer.send({
      token: asset.address,
      to: to.trim(),
      amountRaw,
      amount: amountNum,
      symbol: asset.symbol,
    });
  };

  // ── success ─────────────────────────────────────────────────────────────────
  if (transfer.phase === "done" && transfer.result) {
    const r = transfer.result;
    return (
      <div className="screen screen-pad-top" style={{ display: "flex", flexDirection: "column" }}>
        <div
          className="anim-rise"
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 28px", textAlign: "center", gap: 16 }}
        >
          <span style={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}>
            <Icon name="check" size={38} stroke={2.4} />
          </span>
          <div>
            <h1 className="serif" style={{ margin: 0, fontSize: 28, letterSpacing: "-.01em" }}>Sent</h1>
            <p style={{ margin: "8px 0 0", fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {r.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} {r.symbol} to{" "}
              <b className="mono" style={{ color: "var(--ink)" }}>{shortAddress(r.to)}</b>
            </p>
          </div>
          <a className="caption" href={txUrl(r.txHash, chain)} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            View on {chain.explorer.name} <Icon name="arrowUR" size={14} />
          </a>
        </div>
        <div style={{ padding: "0 22px calc(20px + env(safe-area-inset-bottom))" }}>
          <button className="btn btn-primary btn-block btn-lg tap" onClick={() => go("wallet")}>Done</button>
        </div>
      </div>
    );
  }

  // The primary action, rendered either after the form or inside the keypad
  // frame — same markup, so the two placements can never drift apart.
  const action = (
    <>
      {!confirming ? (
        <button
          className="btn btn-primary btn-block btn-lg tap"
          disabled={!canReview}
          style={{ opacity: canReview ? 1 : 0.5 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setConfirming(true)}
        >
          Review
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ textAlign: "center", fontSize: 14, color: "var(--ink-2)" }}>
            Send <b className="tnum" style={{ color: "var(--ink)" }}>{amountNum.toLocaleString("en-US", { maximumFractionDigits: 6 })} {asset.symbol}</b>
            {" to "}
            <b className="mono" style={{ color: "var(--ink)" }}>{shortAddress(to.trim())}</b>
          </div>
          <button className="btn btn-primary btn-block btn-lg tap" disabled={transfer.busy} onClick={onSend}>
            {transfer.busy ? <Spinner small /> : "Send now"}
          </button>
          {!transfer.busy && (
            <button className="btn btn-ghost btn-block tap" onClick={() => setConfirming(false)}>Edit</button>
          )}
        </div>
      )}
    </>
  );

  // ── compose ─────────────────────────────────────────────────────────────────
  return (
    <div className="screen screen-pad-top" style={{ display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Send</h1>
      </div>

      {/* The form sits directly under the header; the action follows the form
          instead of being pushed to the bottom over a band of empty space. */}
      <div style={{ padding: "16px 22px 0" }}>
        {/* asset selector */}
        <div className="label-eyebrow" style={{ marginBottom: 8 }}>Asset</div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
          {assets.map((a, i) => {
            const on = i === sel;
            return (
              <button
                key={a.symbol}
                onClick={() => { setSel(i); pad.setValue(""); setConfirming(false); }}
                className="tap"
                style={{
                  flex: "none",
                  padding: "8px 14px 8px 8px",
                  borderRadius: 13,
                  background: on ? "var(--primary)" : "var(--surface-2)",
                  color: on ? "var(--primary-ink)" : "var(--ink)",
                  fontWeight: 600,
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  minWidth: 84,
                }}
              >
                <TokenLogo symbol={a.symbol} name={a.name} size={30} />
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                  <span>{a.symbol}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 500, opacity: on ? 0.85 : 0.6 }}>
                    {tokenQty(a.raw, a.decimals)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* amount */}
        <div className="label-eyebrow" style={{ marginBottom: 8 }}>Amount</div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AmountInput
              {...pad.field}
              onChange={onAmount}
              onFocus={() => setPadOpen(true)}
              onEscape={() => setPadOpen(false)}
              aria-label={`Amount of ${asset.symbol} to send`}
              aria-invalid={overBalance || undefined}
              aria-describedby={overNote ? "send-amount-error" : undefined}
              className="tnum"
              style={{ flex: 1, minWidth: 0, fontSize: 34, fontWeight: 700, letterSpacing: "-.03em", color: "var(--ink)" }}
            />
            <span style={{ fontWeight: 700, fontSize: 16, color: "var(--ink-2)" }}>{asset.symbol}</span>
            <button onClick={setMax} onMouseDown={(e) => e.preventDefault()} className="tap" style={{ minHeight: 40, padding: "0 13px", borderRadius: 11, background: "var(--surface-2)", color: "var(--primary)", fontWeight: 700, fontSize: 13 }}>
              Max
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12.5, color: "var(--ink-2)" }}>
            <span>{usdValue !== undefined ? `≈ ${usd(usdValue)}` : " "}</span>
            <span className="tnum">Balance {tokenQty(asset.raw, asset.decimals)} {asset.symbol}</span>
          </div>
        </div>
        {overNote && (
          <div id="send-amount-error" role="status" style={{ marginTop: 8, fontSize: 13, color: "var(--neg)", fontWeight: 500 }}>
            That’s more than your {asset.symbol} balance.
          </div>
        )}

        {/* recipient */}
        <div className="label-eyebrow" style={{ margin: "18px 0 8px" }}>To</div>
        <div
          className="card"
          style={{
            padding: "4px 8px 4px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            ...(addrError ? { boxShadow: "var(--glass-shadow), var(--glass-hi), inset 0 0 0 1.5px var(--neg)" } : {}),
          }}
        >
          <input
            ref={toRef}
            placeholder={`${chain.name} address (0x…)`}
            aria-label={`Recipient ${chain.name} address`}
            aria-invalid={addrError || undefined}
            aria-describedby={addrError ? "send-to-error" : undefined}
            value={to}
            onChange={(e) => { setTo(e.target.value); setConfirming(false); }}
            onFocus={() => setPadOpen(false)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="mono"
            style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 14, padding: "14px 0", color: "var(--ink)" }}
          />
          {to.trim().length === 0 && canPaste ? (
            <button
              type="button"
              onClick={paste}
              className="tap"
              style={{ minHeight: 40, padding: "0 12px", borderRadius: 11, flex: "none", display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface-2)", color: "var(--primary)", fontWeight: 700, fontSize: 13 }}
            >
              <Icon name="paste" size={15} stroke={2.2} />
              Paste
            </button>
          ) : to.trim().length > 0 ? (
            <Icon
              name={addrValid ? "check" : "close"}
              size={18}
              stroke={2.2}
              style={{ color: addrValid ? "var(--primary)" : "var(--neg)", flex: "none", marginRight: 8 }}
            />
          ) : null}
        </div>
        {addrError && (
          <p id="send-to-error" role="alert" style={{ margin: "8px 4px 0", fontSize: 13, fontWeight: 500, color: "var(--neg)", lineHeight: 1.45 }}>
            That doesn’t look like a {chain.name} address. It starts with 0x and is 42 characters long.
          </p>
        )}

        {/* safety note */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", marginTop: 16, borderRadius: 14, background: "var(--accent-soft)", color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.5 }}>
          <Icon name="info" size={16} stroke={2} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
          <span>
            Double-check the address. It must be on the <b style={{ color: "var(--ink)" }}>{`${chain.name} network`}</b>. Transfers can’t be undone.
          </span>
        </div>

        {transfer.error && (
          <div style={{ marginTop: 12, fontSize: 13.5, color: "var(--neg)", fontWeight: 500 }}>{transfer.error}</div>
        )}
      </div>

      {/* The action follows the form, and moves into the keypad frame while the
          keys are up so it stays reachable without dismissing them. */}
      {!padOpen && (
        <div style={{ padding: "20px 22px calc(18px + env(safe-area-inset-bottom))" }}>{action}</div>
      )}
      <Keypad {...pad.keypad} onChange={onAmount} open={padOpen} footer={action} />
    </div>
  );
}
