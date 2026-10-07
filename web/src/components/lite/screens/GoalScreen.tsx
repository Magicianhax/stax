"use client";

// Goal input — faithful re-skin of the design (screens_lite.jsx · GoalInput).
// Conversational goal + amount + suggestion chips. On "Build my plan" it hands
// { goal, amt } up to the router, which calls useInvest.allocate (POST /api/allocate).
import { useState } from "react";
import { useUsdcBalance } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { Icon, VeraOrb, ChainLaunching, AmountInput, Keypad } from "@/components/design";
import { useAmountKeypad, toAmountString } from "@/hooks/useAmountKeypad";
import { usd } from "@/lib/format";
import { iconBtn, VeraTag } from "./primitives";
import { useChainReady } from "../useChainReady";

// Suggestions follow the amount typed above, so a chip never names a figure
// the person can't invest. Small amounts get starter-sized wording.
function suggestionsFor(amount: number): string[] {
  const has = Number.isFinite(amount) && amount > 0;
  const grow = has ? `Grow $${Math.round(amount).toLocaleString("en-US")}, mostly big tech, keep a little safe` : "Grow it, mostly big tech, keep a little safe";
  if (has && amount < 50) {
    return [grow, "Play it safe and still earn a bit", "Start small with a bit of everything", "A small bet on AI companies"];
  }
  return [grow, "Play it safe and still earn a bit", "A little of everything to start", "Go big on AI companies"];
}

export function GoalScreen({
  go,
  refusal = null,
  onDismissRefusal,
  initialGoal,
  initialAmount,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
  /** Why Vera wouldn't build the last plan (market closed, under $6 a stock), shown as a calm note. */
  refusal?: string | null;
  onDismissRefusal?: () => void;
  /** What was typed when Vera said no, so nobody has to type it again. */
  initialGoal?: string;
  initialAmount?: number;
}) {
  const { address } = useSmartAccount();
  const { chain, investable: ready } = useChainReady();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const balance = bal?.value ?? 0;

  const [goal, setGoal] = useState(initialGoal ?? "");
  // Default amount: $300 when the cash covers it, otherwise a round figure the
  // balance does cover, so the screen never opens already in an error state.
  // The user's own edits win once they type.
  const [edited, setEdited] = useState<string | null>(initialAmount ? String(initialAmount) : null);
  const suggested = balance >= 300 ? "300" : String(Math.floor(balance / 10) * 10 || Math.floor(balance));
  // The keypad owns the edited value; the suggestion stands until they touch it.
  // The cash on hand is the ceiling, but only once the balance has loaded.
  const pad = useAmountKeypad({ max: bal ? balance : undefined, initial: initialAmount ? String(initialAmount) : undefined });
  const amt = edited === null ? suggested : pad.value;
  const setAmt = (v: string) => {
    setEdited(v);
    pad.setValue(v);
  };
  // The goal text needs the OS keyboard, so ours is up only while the amount
  // has focus. It starts down: this screen is about the sentence, not the sum.
  const [padOpen, setPadOpen] = useState(false);

  const amount = parseFloat(amt);
  // More than the cash on hand: say so inline, right under the amount, and hold
  // the button rather than letting the plan fail later at the allocate step.
  const over = amount > balance + 1e-6;
  // The keypad refuses a key that would go over; the same line explains why.
  const overNote = over || pad.refused;
  const canBuild = goal.trim().length > 3 && amount > 0 && !over;

  // The primary action, rendered either at the bottom of the screen or inside
  // the keypad frame — one definition, so the two placements cannot drift.
  const action = ready ? (
    <button
      className="btn btn-primary btn-block btn-lg tap"
      disabled={!canBuild}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => go("thinking", { goal: goal.trim(), amt: amount })}
    >
      <VeraOrb size={26} /> Build my plan
    </button>
  ) : (
    // Contracts not deployed on this network yet: say so calmly, offer the one
    // thing that does work (browsing prices) instead of a dead button.
    <ChainLaunching
      chain={chain}
      action={
        <button className="btn btn-ghost btn-block tap" onClick={() => go("market")}>
          Browse the market
        </button>
      }
    />
  );

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: padOpen ? 0 : 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go("home")} style={iconBtn} className="tap" aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <div style={{ marginLeft: 4 }}>
          <VeraTag verified />
        </div>
      </div>

      <div className="anim-rise" style={{ padding: "26px 22px 0", flex: 1 }}>
        <h1 className="display" style={{ margin: 0 }}>
          What are you
          <br />
          hoping to do?
        </h1>
        <p className="body" style={{ marginTop: 12, maxWidth: 300 }}>
          Say it however feels natural. No finance words needed; I’ll handle the rest.
        </p>

        {/* Vera's own "no": a normal answer, so a calm note, never the red error banner. */}
        {refusal && (
          <div
            role="status"
            className="card anim-rise"
            style={{ marginTop: 20, padding: "13px 15px", display: "flex", gap: 11, alignItems: "flex-start" }}
          >
            <Icon name="clock" size={18} style={{ flex: "none", marginTop: 2, color: "var(--ink-2)" }} />
            <div style={{ fontSize: 14.5, lineHeight: 1.5, color: "var(--ink)" }}>{refusal}</div>
          </div>
        )}

        {/* amount */}
        <div style={{ marginTop: refusal ? 22 : 28 }}>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            How much to invest
          </div>
          <div
            className="field"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 16px",
              ...(overNote ? { boxShadow: "var(--glass-shadow), var(--glass-hi), inset 0 0 0 1.5px var(--neg)" } : {}),
            }}
          >
            <span className="tnum" style={{ fontSize: 30, fontWeight: 700, color: "var(--ink-3)" }}>
              $
            </span>
            <AmountInput
              {...pad.field}
              value={amt}
              onChange={setAmt}
              onFocus={() => {
                // Focusing the amount adopts the suggestion as an edited value,
                // so the first keystroke edits the number that is on screen.
                if (edited === null) pad.setValue(suggested);
                setEdited((e) => e ?? suggested);
                setPadOpen(true);
              }}
              onEscape={() => setPadOpen(false)}
              aria-label="Amount to invest"
              aria-invalid={overNote || undefined}
              aria-describedby={overNote ? "goal-amount-error" : undefined}
              className="tnum"
              style={{
                flex: 1,
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: "-.02em",
                width: "100%",
              }}
            />
            <span className="caption" style={{ fontWeight: 500 }}>of {usd(balance)}</span>
          </div>
          {overNote && (
            <p id="goal-amount-error" role="alert" style={{ margin: "8px 4px 0", fontSize: 13, fontWeight: 500, color: "var(--neg)", lineHeight: 1.45 }}>
              That’s more than the {usd(balance)} you have to invest. Add cash, or start smaller.
            </p>
          )}
        </div>

        {/* goal text */}
        <div style={{ marginTop: 18 }}>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            Your goal
          </div>
          <div className="field" style={{ padding: "14px 16px" }}>
            <textarea
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value);
                onDismissRefusal?.();
              }}
              onFocus={() => setPadOpen(false)}
              rows={3}
              aria-label="Your goal"
              placeholder="e.g. Grow this over a few years, mostly big names, but keep some safe…"
              style={{
                width: "100%",
                fontSize: 16,
                lineHeight: 1.45,
                display: "block",
              }}
            />
          </div>
        </div>

        {/* suggestions */}
        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {suggestionsFor(amount).map((s) => (
            <button
              key={s}
              className={`chip tap ${goal === s ? "is-on" : ""}`}
              onClick={() => setGoal(s)}
              style={{ height: "auto", padding: "9px 13px", whiteSpace: "normal", textAlign: "left", lineHeight: 1.3 }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* The action stays at the bottom, and moves into the keypad frame while
          the keys are up so it never sits behind them. */}
      {!padOpen && (
        <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>{action}</div>
      )}
      <Keypad
        {...pad.keypad}
        onChange={setAmt}
        open={padOpen}
        presets={[100, 300, 500]}
        extra={
          balance > 0 ? (
            <button
              type="button"
              className="chip tap"
              style={{ flex: "none", height: 38 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setAmt(toAmountString(balance))}
            >
              Max
            </button>
          ) : undefined
        }
        footer={action}
      />
    </div>
  );
}
