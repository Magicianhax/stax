"use client";

// Give a basket — one screen that asks five short questions and reveals the next
// only once the last is answered, then a review card and a hold-to-confirm.
// Reached from a basket ("Gift this basket", basket pre-filled) or from the Invest hub
// ("Gift a basket", basket picked from a rail here).
//
// The screen owns the whole moment: form → sending → sent. Nothing routes away
// mid-flight, so a back-swipe can't strand a half-sent gift — which matters more
// here than anywhere else, because giving is two transactions (docs/GIFTS.md).
import { useMemo, useState } from "react";
import { Icon, ChainLaunching, AmountInput, Keypad, LogoCluster } from "@/components/design";
import { useAmountKeypad } from "@/hooks/useAmountKeypad";
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
import { clusterOf } from "./basketPrimitives";
import { CashSliceNote, GiftBasketHead, DetailRow, SplitList, Step } from "../gift/giftPrimitives";
import { GiftPlacing } from "../gift/GiftPlacing";
import { GiftSent } from "../gift/GiftSent";
import {
  addYears,
  earliestUnlock,
  resolveUnlock,
  type UnlockPreset,
  reviewRows,
  todayAnchor,
  toDateInput,
  toDateTimeInput,
  unlockWhenFromSeconds,
  untilLabelFromSeconds,
} from "../gift/giftFormat";
import {
  GIFT_AMOUNTS,
  GIFT_MAX_UNLOCK_YEARS,
  GIFT_MIN_UNLOCK_MINUTES,
  GIFT_MAX_USD,
  GIFT_MIN_USD,
  GIFT_NOTE_MAX,
  X_USERNAME_MAX,
  parseGiftRecipient,
  recipientLabel,
  type GiftRecipientKind,
} from "../gift/types";

type Preset = UnlockPreset;

/** The two ways to address a gift, in the order the segmented control shows them. */
const RECIPIENT_KINDS: { id: GiftRecipientKind; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "x", label: "X" },
];

const PRESETS: { id: Preset; label: string }[] = [
  { id: "days", label: "In N days" },
  { id: "1y", label: "In a year" },
  { id: "5y", label: "In 5 years" },
  { id: "18th", label: "Their 18th" },
  { id: "custom", label: "Pick a date and time" },
];

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

  // Amount entry is the shared keypad. Its ceiling is the smaller of the gift
  // limit and the cash on hand, so a key that would break either is refused
  // rather than typed and then argued with. No ceiling until the balance lands.
  const pad = useAmountKeypad({ max: bal ? Math.min(GIFT_MAX_USD, balance) : GIFT_MAX_USD });
  const amt = pad.value;
  // Ours is up only while the amount field has focus; the email and note fields
  // on the steps either side want the OS keyboard instead.
  const [amountFocused, setAmountFocused] = useState(false);
  const amount = parseFloat(amt);
  const amountOk = Number.isFinite(amount) && amount >= GIFT_MIN_USD && amount <= GIFT_MAX_USD;

  // Who it's for: an email address, or an X username they sign in with instead.
  // Both fields are kept, so switching back and forth doesn't lose what was typed.
  const [recipientKind, setRecipientKind] = useState<GiftRecipientKind>("email");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  // Same reason the amount step holds while the keypad is up: a handle is valid from its
  // FIRST character ("j" on the way to "jack"), so without this the question would close
  // itself out from under someone still typing the name.
  const [recipientFocused, setRecipientFocused] = useState(false);
  const isX = recipientKind === "x";
  const typedRecipient = isX ? handle : email;
  // The very function the API validates with, so the step cannot accept a recipient
  // the server would then refuse. Null until it is a real address or handle.
  const recipient = parseGiftRecipient(
    isX ? { kind: "x", username: handle } : { kind: "email", email },
  );
  const recipientOk = recipient !== null;

  const [preset, setPreset] = useState<Preset | null>(null);
  const [dob, setDob] = useState("");
  const [custom, setCustom] = useState("");
  const [days, setDays] = useState("");
  const today = todayAnchor();
  const latest = addYears(today, GIFT_MAX_UNLOCK_YEARS);

  // Plain arithmetic over four bits of state — no memo. `today` is recomputed
  // each render (it is a clock read), which is exactly the kind of dependency a
  // useMemo here could not honestly hold on to.
  const nowSec = earliestUnlock(0);
  const unlockAt = resolveUnlock(preset, today, dob, custom, days, nowSec);
  // Far enough ahead for the two transactions to land, and inside the cap.
  const earliest = earliestUnlock(GIFT_MIN_UNLOCK_MINUTES);
  const unlockOk = unlockAt !== null && unlockAt >= earliest && unlockAt <= latest;

  const [note, setNote] = useState("");

  // Which question is being asked. Tapping an answered step reopens it.
  const [editing, setEditing] = useState<number | null>(null);
  const answered = [Boolean(basket), amountOk, recipientOk, unlockOk];
  const nextStep = answered.findIndex((a) => !a);
  const reachedStep = nextStep === -1 ? 5 : nextStep + 1;
  // While a field is being typed into the flow holds at its step. "50" on the way to
  // "500" is a valid figure for one keystroke, and "j" on the way to "jack" is a valid
  // handle; letting either reveal the next question would pull the field out from under
  // the person mid-word. Each is released by the step's own Next, never by a blur — a
  // blur fires before the click it belongs to, and would unmount the button being tapped.
  const current = amountFocused
    ? Math.min(reachedStep, 2)
    : recipientFocused
      ? Math.min(reachedStep, 3)
      : reachedStep;
  const openStep = (n: number) => (editing !== null ? editing === n : n === current || (n === 5 && current === 5));
  /** Put every field down. What the next step's own focus handler undoes. */
  const blurFields = () => {
    setAmountFocused(false);
    setRecipientFocused(false);
  };
  const answerStep = (n: number) => {
    blurFields();
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
  // The pad is up from the moment the amount takes focus until something else
  // takes it — Escape, Next, or another field. Focus alone is too fragile a
  // signal: tapping a key must not be able to close the thing you are tapping.
  const padOpen = amountFocused && Boolean(basket);
  // One sentence under the amount, covering both a value that does not fit and
  // a key the ceiling just refused.
  const amountNote =
    overBalance || (pad.refused && amount > balance - 1e-9)
      ? `That's more than the ${usd(balance)} you have to invest.`
      : Number.isFinite(amount) && amount > 0 && amount < GIFT_MIN_USD
        ? `The smallest gift is ${usd(GIFT_MIN_USD)} — below that the trading costs eat it.`
        : pad.refused || (Number.isFinite(amount) && amount > GIFT_MAX_USD)
          ? `The largest gift is ${usd(GIFT_MAX_USD)}.`
          : null;
  const canSend = Boolean(basket) && amountOk && recipientOk && unlockOk && ready && giftsOn && !overBalance;
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
            : !recipientOk
              ? isX
                ? "Add the X username it's for."
                : "Add the email address it's for."
              : !unlockOk
                ? "Choose when they can open it."
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
        recipient,
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
          onEdit={basket ? () => { blurFields(); setEditing(1); } : undefined}
        >
          {giftable.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Nothing to gift on {chain.name} yet. Save a basket first and it&apos;ll appear here.
            </p>
          ) : (
            /* A stacked list, not a rail: this step owns a tall, otherwise empty
               screen, so sideways scrolling hid most of the choices behind an
               edge for no reason. Every basket is visible and comparable. */
            <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "4px -4px 0" }} role="radiogroup" aria-label="Basket to gift">
              {giftable.map((b) => {
                const on = b.id === pickedId;
                return (
                  <button
                    key={b.id}
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      haptic.select();
                      setPickedId(b.id);
                      answerStep(1);
                    }}
                    className="tap"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      minHeight: 64,
                      padding: "12px 12px",
                      borderRadius: 16,
                      textAlign: "left",
                      background: on ? "var(--primary-soft)" : "var(--surface-2)",
                      boxShadow: on
                        ? "inset 0 0 0 1.5px var(--primary)"
                        : "inset 0 0 0 1px var(--line)",
                      transition: "background .2s var(--ease-out), box-shadow .2s var(--ease-out)",
                    }}
                  >
                    <LogoCluster assets={clusterOf(b)} size={26} max={3} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontWeight: 600,
                          fontSize: 15,
                          letterSpacing: "-.01em",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {b.name}
                      </span>
                      <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                        {riskWord(b.riskScore)} · {b.items.length} holdings
                      </span>
                    </span>
                    {on && <Icon name="check" size={18} style={{ color: "var(--primary)", flex: "none" }} />}
                  </button>
                );
              })}
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
              <AmountInput
                {...pad.field}
                onFocus={() => { setRecipientFocused(false); setAmountFocused(true); }}
                onEscape={() => setAmountFocused(false)}
                placeholder="0"
                aria-label="Amount to gift"
                aria-invalid={amountNote !== null || undefined}
                aria-describedby={amountNote ? "gift-amount-error" : undefined}
                className="tnum"
                style={{ flex: 1, fontSize: 28, fontWeight: 700, letterSpacing: "-.02em", width: "100%" }}
              />
            </div>
            {/* Quick amounts live in the keypad frame, where they stay reachable
                with the keys up. */}
            {amountNote && (
              <p id="gift-amount-error" role="status" style={{ margin: "12px 0 0", fontSize: 13, color: "var(--neg)", fontWeight: 600, lineHeight: 1.45 }}>
                {amountNote}
              </p>
            )}
            {!padOpen && amountOk && !overBalance && (
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
            hint={
              isX ? "Their X username. Only they can open it." : "Their email. Only they can open it."
            }
            answer={recipient ? recipientLabel(recipient) : undefined}
            open={openStep(3)}
            onEdit={recipientOk ? () => { blurFields(); setEditing(3); } : undefined}
          >
            {/* Email or X — the same gift either way, only the sign-in differs. */}
            <div className="seg" role="group" aria-label="How to address the gift" style={{ marginBottom: 12 }}>
              <span
                className="seg-thumb"
                style={{ width: "calc((100% - 8px) / 2)", left: 4, transform: `translateX(${isX ? "100%" : "0"})` }}
              />
              {RECIPIENT_KINDS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => {
                    haptic.select();
                    setAmountFocused(false);
                    setRecipientFocused(true);
                    setRecipientKind(k.id);
                  }}
                  className={`seg-item ${recipientKind === k.id ? "is-on" : ""}`}
                  style={{ height: 44 }}
                  aria-pressed={recipientKind === k.id}
                >
                  {k.label}
                </button>
              ))}
            </div>

            {isX ? (
              /* The "@" is drawn, not typed: it belongs to every handle, so making
                 people enter it would only be a character they could get wrong. One
                 pasted in anyway is stripped rather than argued with. The gap is
                 tighter than the mail row's, because the "@" is part of the handle and
                 has to read as "@jack", not as an icon standing next to a word. */
              <div className="field" style={{ display: "flex", alignItems: "center", gap: 2, padding: "12px 14px" }}>
                <Icon name="atSign" size={18} style={{ color: "var(--ink-3)", flex: "none" }} />
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.replace(/^@+/, "").slice(0, X_USERNAME_MAX))}
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onFocus={() => { setAmountFocused(false); setRecipientFocused(true); }}
                  placeholder="username"
                  aria-label="Their X username"
                  aria-invalid={(handle.length > 0 && !recipientOk) || undefined}
                  style={{ flex: 1, fontSize: 16, width: "100%" }}
                />
              </div>
            ) : (
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
                  onFocus={() => { setAmountFocused(false); setRecipientFocused(true); }}
                  placeholder="name@example.com"
                  aria-label="Their email address"
                  aria-invalid={(email.length > 3 && !recipientOk) || undefined}
                  style={{ flex: 1, fontSize: 16, width: "100%" }}
                />
              </div>
            )}
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}>
              {typedRecipient.length > (isX ? 0 : 3) && !recipientOk
                ? isX
                  ? "Letters, numbers and underscores only — up to 15."
                  : "That doesn't look like an email address yet."
                : isX
                  ? "They don't need an account yet. They'll sign in with that X account to open it."
                  : "They don't need an account yet. They'll sign in with this address to open it."}
            </p>
            {recipientOk && (
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
            answer={unlockOk ? unlockWhenFromSeconds(unlockAt as number) : undefined}
            open={openStep(4)}
            onEdit={unlockOk ? () => { blurFields(); setEditing(4); } : undefined}
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

            {preset === "days" && (
              <label style={{ display: "block", marginTop: 14 }}>
                <span className="label-eyebrow">How many days from now</span>
                <div className="field" style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "12px 14px", marginTop: 7 }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={days}
                    onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
                    placeholder="30"
                    className="tnum"
                    aria-label="How many days from now"
                    style={{ fontSize: 17, fontWeight: 600, width: "100%", minHeight: 24 }}
                  />
                  <span style={{ fontSize: 14, color: "var(--ink-2)", flex: "none" }}>
                    {days === "1" ? "day" : "days"}
                  </span>
                </div>
              </label>
            )}

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
                <span className="label-eyebrow">When it opens</span>
                <div className="field" style={{ padding: "12px 14px", marginTop: 7 }}>
                  <input
                    type="datetime-local"
                    value={custom}
                    min={toDateTimeInput(earliest)}
                    max={toDateTimeInput(latest)}
                    onChange={(e) => setCustom(e.target.value)}
                    className="tnum"
                    aria-label="When it opens"
                    style={{ fontSize: 16, width: "100%", minHeight: 24 }}
                  />
                </div>
              </label>
            )}

            {unlockOk && (
              <>
                <p className="tnum" style={{ margin: "14px 0 0", fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>
                  Unlocks {unlockWhenFromSeconds(unlockAt as number)}
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
            {preset !== null &&
              !unlockOk &&
              (preset === "18th" ? dob : preset === "custom" ? custom : preset === "days" ? days : "") !== "" && (
              <p role="status" style={{ margin: "12px 0 0", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
                {unlockAt !== null && unlockAt > latest
                  ? `The furthest out a gift can go is ${GIFT_MAX_UNLOCK_YEARS} years.`
                  : `Pick a time at least ${GIFT_MIN_UNLOCK_MINUTES} minutes from now, so it is invested before it opens.`}
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
                onFocus={blurFields}
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

      {/* review — step 5 is only reached once the recipient is valid, but saying so
          here is what lets the card read the answer without a fallback for "nobody". */}
      {current >= 5 && basket && recipient && (
        <Reveal delay={0.06} style={{ padding: "8px 22px 0" }}>
          <div className="card" style={{ padding: 18 }}>
            <GiftBasketHead name={basket.name} items={items} />
            <div style={{ marginTop: 14, paddingTop: 4, borderTop: "1px solid var(--line-2)" }}>
              <SplitList rows={reviewRows(items, invested, cash)} />
            </div>
            {hasCashSlice && <CashSliceNote style={{ marginTop: 12 }} />}
            <div style={{ marginTop: 4 }}>
              {/* An X handle in full — "@jack" is public. An email stays masked. */}
              <DetailRow label="For" value={recipientLabel(recipient)} />
              <DetailRow
                label="Opens"
                value={
                  <span className="tnum">
                    {unlockWhenFromSeconds(unlockAt as number)}
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
              The money is invested now and held safely until {unlockWhenFromSeconds(unlockAt as number)}. They can
              claim it from their own account that day. If they never do, you can take it back three months later.
            </p>
          </div>
        </Reveal>
      )}

      {/* Pinned confirm — stands down while the keypad has the bottom edge; you
          cannot send a gift whose amount you are still typing. */}
      <div
        hidden={padOpen}
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "22px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) calc(100% - 22px), transparent)",
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
              {blocker ??
                (isX
                  ? "They'll need to sign in with that X account to open it."
                  : "They'll need to sign in with that email to claim it.")}
            </p>
          </>
        )}
      </div>

      <Keypad
        {...pad.keypad}
        open={padOpen}
        presets={[...GIFT_AMOUNTS]}
        footer={
          <button
            className="btn btn-primary btn-block tap"
            style={{ minHeight: 52 }}
            disabled={!amountOk || overBalance}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setAmountFocused(false);
              answerStep(2);
            }}
          >
            Next
          </button>
        }
      />
    </div>
  );
}
