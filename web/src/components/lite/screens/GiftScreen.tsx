"use client";

// Give a basket — one screen that asks five short questions and reveals the next
// only once the last is answered, then a review card and a hold-to-confirm.
// Reached from a basket ("Gift this basket", basket pre-filled) or from Vera
// ("Gift a basket", basket picked from a rail here).
//
// The screen owns the whole moment: form → sending → sent. Nothing routes away
// mid-flight, so a back-swipe can't strand a half-sent gift — which matters more
// here than anywhere else, because giving is two transactions (docs/GIFTS.md).
import { useMemo, useState } from "react";
import { Icon, ChainLaunching } from "@/components/design";
import { HoldButton, Reveal } from "@/components/motion";
import { useBaskets } from "@/hooks/useBaskets";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useUsdcBalance } from "@/hooks/useBalances";
import { useGiftsEnabled, useSendGift } from "@/hooks/useGifts";
import { isBasketInvestable, riskWord, type Basket } from "@/lib/baskets";
import { splitGiftBasket } from "@/lib/gifts";
import { feeUsd } from "@/lib/fees";
import { usd } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { iconBtn } from "./primitives";
import { useChainReady } from "../useChainReady";
import { BasketRailTile } from "./basketPrimitives";
import { CashSliceNote, GiftBasketHead, DetailRow, SplitList, Step } from "../gift/giftPrimitives";
import { GiftPlacing } from "../gift/GiftPlacing";
import { GiftSent } from "../gift/GiftSent";
import {
  addYears,
  fromDateInput,
  reviewRows,
  todayAnchor,
  toDateInput,
  unlockDateFromSeconds,
  untilLabelFromSeconds,
} from "../gift/giftFormat";
import {
  GIFT_AMOUNTS,
  GIFT_MAX_UNLOCK_YEARS,
  GIFT_MAX_USD,
  GIFT_MIN_USD,
  GIFT_NOTE_MAX,
  looksLikeEmail,
  maskEmail,
} from "../gift/types";

type Preset = "1y" | "5y" | "18th" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "1y", label: "In a year" },
  { id: "5y", label: "In 5 years" },
  { id: "18th", label: "Their 18th" },
  { id: "custom", label: "Pick a date" },
];

/** The unlock day the chosen preset works out to, in unix seconds, or null. */
function resolveUnlock(preset: Preset | null, today: number, dob: string, custom: string): number | null {
  if (preset === "1y") return addYears(today, 1);
  if (preset === "5y") return addYears(today, 5);
  if (preset === "18th") {
    const born = fromDateInput(dob);
    return born ? addYears(born, 18) : null;
  }
  if (preset === "custom") return fromDateInput(custom);
  return null;
}

export function GiftScreen({
  go,
  basketId,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  /** Pre-filled when the flow started from a basket. */
  basketId?: string;
}) {
  const { chain, ready } = useChainReady();
  const giftsOn = useGiftsEnabled();
  const { all, byId } = useBaskets();
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const balance = bal?.value ?? 0;
  const send = useSendGift();

  const giftable = useMemo(
    () => all.filter((b) => b.chain === chain.key && isBasketInvestable(chain, b)),
    [all, chain],
  );

  const [pickedId, setPickedId] = useState<string | undefined>(basketId);
  const basket: Basket | undefined = byId(pickedId);

  const [amt, setAmt] = useState("");
  const amount = parseFloat(amt);
  const amountOk = Number.isFinite(amount) && amount >= GIFT_MIN_USD && amount <= GIFT_MAX_USD;

  const [email, setEmail] = useState("");
  const emailOk = looksLikeEmail(email);

  const [preset, setPreset] = useState<Preset | null>(null);
  const [dob, setDob] = useState("");
  const [custom, setCustom] = useState("");
  const today = todayAnchor();
  const latest = addYears(today, GIFT_MAX_UNLOCK_YEARS);

  // Plain arithmetic over four bits of state — no memo. `today` is recomputed
  // each render (it is a clock read), which is exactly the kind of dependency a
  // useMemo here could not honestly hold on to.
  const unlockAt = resolveUnlock(preset, today, dob, custom);
  const unlockOk = unlockAt !== null && unlockAt > today && unlockAt <= latest;

  const [note, setNote] = useState("");

  // Which question is being asked. Tapping an answered step reopens it.
  const [editing, setEditing] = useState<number | null>(null);
  const answered = [Boolean(basket), amountOk, emailOk, unlockOk];
  const nextStep = answered.findIndex((a) => !a);
  const current = nextStep === -1 ? 5 : nextStep + 1;
  const openStep = (n: number) => (editing !== null ? editing === n : n === current || (n === 5 && current === 5));
  const answerStep = (n: number) => {
    if (editing === n) setEditing(null);
  };

  // The split, computed with `splitGiftBasket` — the very function the server
  // runs, exported client-safe, so the review card cannot disagree with what the
  // create call will do. It also marks the slices parked as plain dollars.
  const split = splitGiftBasket(chain.key, basket?.items ?? [], amountOk ? amount : 0);
  const items = split.holdings;
  const hasCashSlice = items.some((i) => i.heldAsCash);

  // The four money lines, in whole cents.
  //
  // The platform fee is skimmed on the invest leg only, so a basket with a safe
  // slice pays it on part of the gift, not all of it. Cash and fee are exact by
  // construction, so ONE line has to absorb the rounding remainder rather than
  // being computed independently — three separately rounded values need not sum
  // to the rounded total. Invested is that line: at $33.33 with a 20% safe slice,
  // deriving it from `investUsd - fee` gave $26.60 and the card added up to
  // $33.34 against a "You pay" of $33.33. Integers throughout, because `0.01` as
  // a float is not exactly a cent and a one-cent drift reads as 0.010000000000005.
  const cents = (v: number) => Math.round(v * 100);
  const cashCents = cents(split.cashUsd);
  const feeCents = cents(feeUsd(split.investUsd));
  const investedCents = cents(amountOk ? amount : 0) - cashCents - feeCents;
  const fee = feeCents / 100;
  const invested = investedCents / 100;
  const cash = cashCents / 100;

  const overBalance = amountOk && amount > balance;
  const canSend = Boolean(basket) && amountOk && emailOk && unlockOk && ready && giftsOn && !overBalance;
  // Why the confirm is off, said next to it — the step that holds the problem
  // may have closed and scrolled away by the time they reach the bottom.
  const blocker = !basket
    ? "Pick a basket to gift."
    : !Number.isFinite(amount) || amount <= 0
      ? "Choose how much to give."
      : amount < GIFT_MIN_USD
        ? `The smallest gift is ${usd(GIFT_MIN_USD)}.`
        : amount > GIFT_MAX_USD
          ? `The largest gift is ${usd(GIFT_MAX_USD)}.`
          : overBalance
            ? `That's more than the ${usd(balance)} you have to invest.`
            : !emailOk
              ? "Add the email address it's for."
              : !unlockOk
                ? "Choose the day they can open it."
                : null;

  // ── sending / sent ──────────────────────────────────────────────────────────
  if (send.phase !== "idle" && send.phase !== "error" && send.phase !== "done") {
    return <GiftPlacing phase={send.phase} />;
  }
  if (send.phase === "done" && send.sent) {
    return <GiftSent gift={send.sent} amountUsd={amount} feeUsd={fee} onDone={() => go("gifts")} />;
  }

  const onSend = () => {
    if (!canSend || !basket || unlockAt === null) return;
    haptic.medium();
    void send.send(
      {
        basketId: basket.id,
        amountUsd: amount,
        recipientEmail: email.trim(),
        unlockAtSeconds: unlockAt,
        note: note.trim() || undefined,
      },
      // Demo only: it has no server to ask what this basket holds.
      { basketName: basket.name, items },
    );
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, marginLeft: 4, fontSize: 22, letterSpacing: "-.01em" }}>
          Give a basket
        </h1>
      </div>

      <Reveal style={{ padding: "10px 22px 4px" }}>
        <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
          Put money into a basket for someone else. It&apos;s invested straight away and held safely until the day
          you choose.
        </p>
      </Reveal>

      {send.error && (
        <div style={{ padding: "12px 22px 0" }}>
          <div
            role="status"
            className="card"
            style={{
              padding: 14,
              background: "color-mix(in srgb, var(--neg) 12%, var(--surface))",
              color: "var(--neg)",
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1.5,
            }}
          >
            {send.error}
          </div>
        </div>
      )}

      <div style={{ padding: "14px 22px 0" }}>
        {/* 1 — which basket */}
        <Step
          n={1}
          title="Which basket?"
          hint="They get the same mix you would."
          answer={basket?.name}
          open={openStep(1)}
          onEdit={basket ? () => setEditing(1) : undefined}
        >
          {giftable.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Nothing to gift on {chain.name} yet. Save a basket first and it&apos;ll appear here.
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                gap: 10,
                overflowX: "auto",
                scrollSnapType: "x mandatory",
                margin: "0 -16px",
                padding: "2px 16px 6px",
              }}
            >
              {giftable.map((b) => (
                <div
                  key={b.id}
                  style={{
                    borderRadius: 20,
                    outline: b.id === pickedId ? "2px solid var(--primary)" : "none",
                    outlineOffset: 2,
                    flex: "none",
                  }}
                >
                  <BasketRailTile
                    basket={b}
                    onClick={() => {
                      haptic.select();
                      setPickedId(b.id);
                      answerStep(1);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </Step>

        {/* 2 — how much */}
        {current >= 2 && (
          <Step
            n={2}
            title="How much?"
            hint={`of ${usd(balance)} available`}
            answer={amountOk ? usd(amount) : undefined}
            open={openStep(2)}
            onEdit={amountOk ? () => setEditing(2) : undefined}
          >
            <div className="field" style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px" }}>
              <span className="tnum" style={{ fontSize: 28, fontWeight: 700, color: "var(--ink-3)" }}>
                $
              </span>
              <input
                value={amt}
                onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0"
                aria-label="Amount to gift"
                className="tnum"
                style={{ flex: 1, fontSize: 28, fontWeight: 700, letterSpacing: "-.02em", width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {GIFT_AMOUNTS.map((q) => (
                <button
                  key={q}
                  className={`chip tap tnum ${amount === q ? "is-on" : ""}`}
                  style={{ height: 40 }}
                  onClick={() => {
                    haptic.select();
                    setAmt(String(q));
                  }}
                >
                  ${q}
                </button>
              ))}
            </div>
            {(overBalance || (Number.isFinite(amount) && amount > 0 && !amountOk)) && (
              <p role="status" style={{ margin: "12px 0 0", fontSize: 13, color: "var(--neg)", fontWeight: 600, lineHeight: 1.45 }}>
                {overBalance
                  ? `That's more than the ${usd(balance)} you have to invest.`
                  : amount < GIFT_MIN_USD
                    ? `The smallest gift is ${usd(GIFT_MIN_USD)} — below that the trading costs eat it.`
                    : `The largest gift is ${usd(GIFT_MAX_USD)}.`}
              </p>
            )}
            {amountOk && !overBalance && (
              <button className="btn btn-ghost btn-block tap" style={{ marginTop: 14, minHeight: 46 }} onClick={() => answerStep(2)}>
                Next
              </button>
            )}
          </Step>
        )}

        {/* 3 — who for */}
        {current >= 3 && (
          <Step
            n={3}
            title="Who's it for?"
            hint="Their email. Only they can open it."
            answer={emailOk ? maskEmail(email) : undefined}
            open={openStep(3)}
            onEdit={emailOk ? () => setEditing(3) : undefined}
          >
            <div className="field" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
              <Icon name="mail" size={18} style={{ color: "var(--ink-3)", flex: "none" }} />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="name@example.com"
                aria-label="Their email address"
                style={{ flex: 1, fontSize: 16, width: "100%" }}
              />
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}>
              {email.length > 3 && !emailOk
                ? "That doesn't look like an email address yet."
                : "They don't need an account yet. They'll sign in with this address to open it."}
            </p>
            {emailOk && (
              <button className="btn btn-ghost btn-block tap" style={{ marginTop: 14, minHeight: 46 }} onClick={() => answerStep(3)}>
                Next
              </button>
            )}
          </Step>
        )}

        {/* 4 — when it opens */}
        {current >= 4 && (
          <Step
            n={4}
            title="When can they open it?"
            hint="It stays invested the whole time."
            answer={unlockOk ? unlockDateFromSeconds(unlockAt as number) : undefined}
            open={openStep(4)}
            onEdit={unlockOk ? () => setEditing(4) : undefined}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`chip tap ${preset === p.id ? "is-on" : ""}`}
                  style={{ height: 40 }}
                  onClick={() => {
                    haptic.select();
                    setPreset(p.id);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {preset === "18th" && (
              <label style={{ display: "block", marginTop: 14 }}>
                <span className="label-eyebrow">Their date of birth</span>
                <div className="field" style={{ padding: "12px 14px", marginTop: 7 }}>
                  <input
                    type="date"
                    value={dob}
                    max={toDateInput(today)}
                    onChange={(e) => setDob(e.target.value)}
                    className="tnum"
                    aria-label="Their date of birth"
                    style={{ fontSize: 16, width: "100%", minHeight: 24 }}
                  />
                </div>
              </label>
            )}

            {preset === "custom" && (
              <label style={{ display: "block", marginTop: 14 }}>
                <span className="label-eyebrow">The day it opens</span>
                <div className="field" style={{ padding: "12px 14px", marginTop: 7 }}>
                  <input
                    type="date"
                    value={custom}
                    min={toDateInput(today + 86_400)}
                    max={toDateInput(latest)}
                    onChange={(e) => setCustom(e.target.value)}
                    className="tnum"
                    aria-label="The day it opens"
                    style={{ fontSize: 16, width: "100%", minHeight: 24 }}
                  />
                </div>
              </label>
            )}

            {unlockOk && (
              <>
                <p className="tnum" style={{ margin: "14px 0 0", fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>
                  Unlocks {unlockDateFromSeconds(unlockAt as number)}
                  <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>
                    {" "}
                    · {untilLabelFromSeconds(unlockAt as number)}
                  </span>
                </p>
                <button className="btn btn-ghost btn-block tap" style={{ marginTop: 12, minHeight: 46 }} onClick={() => answerStep(4)}>
                  Next
                </button>
              </>
            )}
            {preset !== null && !unlockOk && (preset === "18th" ? dob : preset === "custom" ? custom : "") !== "" && (
              <p role="status" style={{ margin: "12px 0 0", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
                {unlockAt !== null && unlockAt > latest
                  ? `The furthest out a gift can go is ${GIFT_MAX_UNLOCK_YEARS} years.`
                  : "Pick a day that hasn't happened yet."}
              </p>
            )}
          </Step>
        )}

        {/* 5 — a note (optional) */}
        {current >= 5 && (
          <Step n={5} title="Add a note?" hint="Optional. They see it when they open it." open={openStep(5)}>
            <div className="field" style={{ padding: "10px 14px" }}>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, GIFT_NOTE_MAX))}
                rows={3}
                placeholder="Happy birthday. Leave it alone and let it grow."
                aria-label="A note for them"
                style={{ width: "100%", fontSize: 15, lineHeight: 1.5, resize: "none" }}
              />
            </div>
            <div className="tnum" style={{ textAlign: "right", fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
              {note.length} / {GIFT_NOTE_MAX}
            </div>
          </Step>
        )}
      </div>

      {/* review */}
      {current >= 5 && basket && (
        <Reveal delay={0.06} style={{ padding: "8px 22px 0" }}>
          <div className="card" style={{ padding: 18 }}>
            <GiftBasketHead name={basket.name} items={items} />
            <div style={{ marginTop: 14, paddingTop: 4, borderTop: "1px solid var(--line-2)" }}>
              <SplitList rows={reviewRows(items, invested, cash)} />
            </div>
            {hasCashSlice && <CashSliceNote style={{ marginTop: 12 }} />}
            <div style={{ marginTop: 4 }}>
              <DetailRow label="For" value={maskEmail(email)} />
              <DetailRow
                label="Opens"
                value={
                  <span className="tnum">
                    {unlockDateFromSeconds(unlockAt as number)}
                    <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>
                      {" "}
                      · {untilLabelFromSeconds(unlockAt as number)}
                    </span>
                  </span>
                }
              />
              {note.trim() && (
                <DetailRow label="Your note" value={<span style={{ fontWeight: 500 }}>“{note.trim()}”</span>} />
              )}
              <DetailRow label="Risk" value={riskWord(basket.riskScore)} />
              {/* The split above adds up to what actually goes in, so the money
                  lines have to agree with it: invested + fee = what you pay. */}
              <DetailRow label="Invested for them" value={usd(invested)} />
              {hasCashSlice && <DetailRow label="Set aside as dollars" value={usd(cash)} />}
              <DetailRow label="Fee" value={`${usd(fee)} · gas on us`} />
              <DetailRow label="You pay" value={usd(amount)} />
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "12px 0 0", lineHeight: 1.5 }}>
              The money is invested now and held safely until {unlockDateFromSeconds(unlockAt as number)}. They can
              claim it from their own account that day. If they never do, you can take it back three months later.
            </p>
          </div>
        </Reveal>
      )}

      {/* pinned confirm */}
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
        ) : !giftsOn ? (
          <div role="status" style={{ textAlign: "center", fontSize: 13, color: "var(--ink-2)", fontWeight: 600, lineHeight: 1.45 }}>
            Gifting is being switched on for {chain.name}. It opens soon.
          </div>
        ) : (
          <>
            <HoldButton onComplete={onSend} disabled={!canSend} className="btn-lg">
              {amountOk ? `Hold to send ${usd(amount)}` : "Hold to send the gift"}
            </HoldButton>
            {/* A disabled button must say why: the reason may be inside a step
                that has already closed and scrolled out of view. */}
            <p
              role={blocker ? "status" : undefined}
              style={{
                fontSize: 12.5,
                color: blocker ? "var(--neg)" : "var(--ink-2)",
                fontWeight: blocker ? 600 : 400,
                margin: "10px 0 0",
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              {blocker ?? "They'll need to sign in with that email to claim it."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
