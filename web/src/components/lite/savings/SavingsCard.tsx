"use client";

// Savings — BSC only, shown on WalletScreen right under Cash. Spare USDT earns through Venus (a
// lending app on BNB Chain) via Binance's DeFi API. Kept deliberately simple for a first-time
// investor (design brief: "so simple even a web2-naive person can use it"):
//   - "Move money in"  — pick an amount from spendable cash, same preset-chip pattern as Add money.
//   - "Move money out" — always takes the WHOLE balance back to cash in one tap. No withdrawal-
//     ratio input: Stax doesn't yet show a user's Venus position size (the DeFi API's position
//     endpoint isn't wired up — see docs/BINANCE-WEB3.md's DeFi section), so a partial-amount
//     picker would have nothing real to validate against and could only guess. "Move money out"
//     redeeming everything is honest today; a partial amount is a v2 once positions are readable.
import { useState } from "react";
import { Icon, SectionTitle, BottomSheet } from "@/components/design";
import { useDemo } from "@/components/demo/DemoProvider";
import { useSavings, useSavingsBalance, useSavingsRate, DEMO_SAVINGS_RATE } from "@/hooks/useSavings";
import { useUsdcBalance } from "@/hooks/useBalances";
import { usd } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { Spinner } from "@/components/lite/screens/primitives";

const PRESETS = [25, 50, 100];

export function SavingsCard({ address }: { address?: string }) {
  const demo = useDemo();
  const { data: rate } = useSavingsRate();
  const { data: bal } = useUsdcBalance(address);
  const { data: savingsBal } = useSavingsBalance(address);
  const savings = useSavings();
  const [sheet, setSheet] = useState<"in" | "out" | null>(null);
  const [amt, setAmt] = useState<number | "custom">(25);
  const [customAmt, setCustomAmt] = useState("");
  // Snapshot of the balance when "Move money out" opened — so the confirm copy and the success
  // amount stay put even after moveOut succeeds and useSavingsBalance refetches down to 0.
  const [outAmount, setOutAmount] = useState(0);

  const effectiveRate = demo ? DEMO_SAVINGS_RATE : rate;
  const cash = bal?.value ?? 0;
  const inSavings = savingsBal ?? 0;
  const hasSavings = inSavings > 0;
  const amount = amt === "custom" ? Math.floor(parseFloat(customAmt) || 0) : Math.min(amt, Math.floor(cash));
  const canMoveIn = amount > 0 && amount <= cash;

  const openIn = () => {
    haptic.light();
    savings.reset();
    setAmt(cash >= 25 ? 25 : "custom");
    setCustomAmt(cash > 0 && cash < 25 ? String(Math.floor(cash)) : "");
    setSheet("in");
  };
  const openOut = () => {
    if (!hasSavings) return;
    haptic.light();
    savings.reset();
    setOutAmount(inSavings);
    setSheet("out");
  };
  const close = () => {
    if (savings.busy) return; // never let a sheet close mid-signature
    setSheet(null);
    if (savings.phase === "done") savings.reset();
  };

  const confirmIn = () => {
    if (!address || !canMoveIn) return;
    haptic.light();
    void savings.moveIn(amount, address);
  };
  const confirmOut = () => {
    if (!address) return;
    haptic.light();
    void savings.moveOut(1, address);
  };

  return (
    <div style={{ padding: "24px 22px 0" }}>
      <SectionTitle>Savings</SectionTitle>
      <div className="card" style={{ padding: "16px 16px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span
            aria-hidden
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              flex: "none",
              display: "grid",
              placeItems: "center",
              background: "var(--primary-soft)",
              color: "var(--primary)",
            }}
          >
            <Icon name="spark" size={19} stroke={2.2} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15.5, letterSpacing: "-.01em" }}>
              {effectiveRate?.available ? `Savings · earns about ${effectiveRate.apyDisplay} a year` : "Savings"}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.45 }}>
              Lent through Venus, a lending app on BNB Chain. You can take it back any time.
            </div>
            {!effectiveRate?.available && (
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>Rate unavailable right now — try again shortly.</div>
            )}
            {hasSavings && (
              <div className="tnum" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 7 }}>
                In Savings: {usd(inSavings)}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button type="button" className="btn btn-primary tap" style={{ flex: 1, height: 44, fontSize: 14.5 }} onClick={openIn}>
            Move money in
          </button>
          <button
            type="button"
            className="btn btn-ghost tap"
            style={{ flex: 1, height: 44, fontSize: 14.5, opacity: hasSavings ? 1 : 0.45 }}
            disabled={!hasSavings}
            onClick={openOut}
          >
            Move money out
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "10px 2px 0", lineHeight: 1.5 }}>
          The rate changes over time. Your money isn’t insured like a bank account — if Venus has a problem, you could lose some or all of it.
        </p>
      </div>

      {/* Move money in */}
      <BottomSheet open={sheet === "in"} onClose={close} title="Move money in">
        {savings.phase === "done" ? (
          <SuccessBody label="Moved to Savings" amount={amount} onDone={close} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "2px 2px 8px" }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Move cash from your spendable balance into Savings. You can move it back anytime.
            </p>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Spendable cash: {usd(cash)}</div>
            <div role="radiogroup" aria-label="Amount" style={{ display: "flex", gap: 8 }}>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={amt === p}
                  disabled={p > cash}
                  onClick={() => { haptic.select(); setAmt(p); }}
                  className={`chip tap ${amt === p ? "is-dark" : ""}`}
                  style={{ flex: 1, justifyContent: "center", height: 44, fontSize: 15, fontWeight: 600, opacity: p > cash ? 0.4 : 1 }}
                >
                  ${p}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={amt === "custom"}
                onClick={() => { haptic.select(); setAmt("custom"); }}
                className={`chip tap ${amt === "custom" ? "is-dark" : ""}`}
                style={{ flex: 1, justifyContent: "center", height: 44, fontSize: 15, fontWeight: 600 }}
              >
                Custom
              </button>
            </div>
            {amt === "custom" && (
              <div className="field" style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", height: 52 }}>
                <span className="tnum" style={{ fontSize: 18, fontWeight: 700, color: customAmt ? "var(--ink)" : "var(--ink-3)" }}>$</span>
                <input
                  inputMode="numeric"
                  autoFocus
                  placeholder="0"
                  value={customAmt}
                  onChange={(e) => setCustomAmt(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  aria-label="Amount to move in, in dollars"
                  className="tnum"
                  style={{ flex: 1, fontSize: 18, fontWeight: 700, background: "transparent", border: "none", outline: "none", padding: 0 }}
                />
              </div>
            )}
            {savings.error && <ErrorLine text={savings.error} />}
            <button
              type="button"
              className="btn btn-primary btn-block tap"
              disabled={!canMoveIn || savings.busy}
              onClick={confirmIn}
              style={{ height: 52 }}
            >
              {savings.busy ? <Spinner small /> : amount > 0 ? `Move ${usd(amount).replace(/\.00$/, "")} to Savings` : "Enter an amount"}
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Move money out */}
      <BottomSheet open={sheet === "out"} onClose={close} title="Move money out">
        {savings.phase === "done" ? (
          <SuccessBody label="Moved back to cash" amount={outAmount > 0 ? outAmount : undefined} onDone={close} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "2px 2px 8px" }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {outAmount > 0
                ? `This takes all ${usd(outAmount)} you’ve put into Savings and moves it back to your spendable cash.`
                : "This takes everything you’ve put into Savings and moves it back to your spendable cash."}
            </p>
            {savings.error && <ErrorLine text={savings.error} />}
            <button
              type="button"
              className="btn btn-primary btn-block tap"
              disabled={savings.busy}
              onClick={confirmOut}
              style={{ height: 52 }}
            >
              {savings.busy ? <Spinner small /> : "Move it all back to cash"}
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 14, background: "color-mix(in srgb, var(--neg) 12%, transparent)", color: "var(--ink)", fontSize: 13, lineHeight: 1.45 }}>
      <Icon name="info" size={16} stroke={2} style={{ flex: "none", marginTop: 1, color: "var(--neg)" }} />
      <span>{text}</span>
    </div>
  );
}

function SuccessBody({ label, amount, onDone }: { label: string; amount?: number; onDone: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "10px 2px 6px" }}>
      <span
        aria-hidden
        style={{ width: 56, height: 56, borderRadius: 99, display: "grid", placeItems: "center", background: "var(--primary)", color: "var(--primary-ink)" }}
      >
        <Icon name="check" size={26} stroke={2.6} />
      </span>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{label}</div>
        {amount !== undefined && <div className="tnum" style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 4 }}>{usd(amount)}</div>}
      </div>
      <button type="button" className="btn btn-primary btn-block tap" onClick={onDone} style={{ height: 50 }}>
        Done
      </button>
    </div>
  );
}
