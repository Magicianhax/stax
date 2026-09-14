"use client";

// Gift-only presentational bits: the status pill, a list row, the two split
// views, and the "step" wrapper the give flow reveals its questions with. Built
// from the incumbent primitives (.card / .chip / .row, LogoCluster, Reveal) —
// nothing here invents a new surface.
//
// There are two ways to show what a gift holds, because there are two moments:
// before it is bought we only have weights (SplitList, dollars by weight), and
// after it is parked we only have raw token amounts (TokenList, quantities).
// Neither is invented from the other.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, LogoCluster } from "@/components/design";
import { Reveal } from "@/components/motion";
import { usd, tokenQty } from "@/lib/format";
import { toTile } from "@/lib/displayAssets";
import { assetBySymbol, type StaxChain } from "@/lib/chains";
import { RampWeightBar } from "../screens/basketPrimitives";
import { GIFT_PILL_LABEL, pillFor, type Gift, type GiftItem, type GiftPill } from "./types";
import type { GiftHolding, GiftToken } from "@/lib/gifts";
import { countdownTo, unlockLocal, untilLabel } from "./giftFormat";

/** Heaviest holding first — LogoCluster input. */
export function clusterOfItems(items: GiftItem[]): { symbol: string }[] {
  return [...items].sort((a, b) => b.weightPct - a.weightPct).map((i) => ({ symbol: i.symbol }));
}

/** The same, for a gift that has already been bought. */
export function clusterOfTokens(tokens: GiftToken[]): { symbol: string }[] {
  return tokens.map((t) => ({ symbol: t.symbol }));
}

/**
 * The logos for a gift. `holdings` is the basket's split as given and is set
 * from the moment the row exists, so it works for a gift still being set up;
 * `tokens` only exists once the parking transaction has landed.
 */
export function clusterOfGift(gift: Pick<Gift, "holdings" | "tokens">): { symbol: string }[] {
  return gift.holdings.length > 0 ? clusterOfItems(gift.holdings) : clusterOfTokens(gift.tokens);
}

const TONE: Record<GiftPill, { fg: string; bg: string }> = {
  preparing: { fg: "var(--ink-2)", bg: "var(--surface-2)" },
  waiting: { fg: "var(--ink-2)", bg: "var(--surface-2)" },
  ready: { fg: "var(--primary)", bg: "var(--primary-soft)" },
  claimed: { fg: "var(--accent)", bg: "var(--accent-soft)" },
  returned: { fg: "var(--ink-2)", bg: "var(--surface-2)" },
  failed: { fg: "var(--neg)", bg: "color-mix(in srgb, var(--neg) 13%, var(--surface))" },
};

const PILL_ICON: Partial<Record<GiftPill, "check" | "clock" | "info">> = {
  ready: "check",
  waiting: "clock",
  preparing: "clock",
  failed: "info",
};

/** Where a gift is, in one word or three. Never a raw status string. */
export function StatusPill({
  gift,
  style,
}: {
  gift: Pick<Gift, "status"> & Partial<Pick<Gift, "claimable" | "direction" | "unlockAt">>;
  style?: CSSProperties;
}) {
  const kind = pillFor(gift);
  const tone = TONE[kind];
  const icon = PILL_ICON[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 24,
        padding: "0 9px",
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        flex: "none",
        background: tone.bg,
        color: tone.fg,
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={13} stroke={2.3} />}
      {GIFT_PILL_LABEL[kind]}
    </span>
  );
}

/**
 * One gift in the "You sent" / "For you" lists.
 *
 * Two lines, not two columns: the name and the amount own the first line, and
 * the pill sits on the second with the timing and who it's between. Putting the
 * pill beside the name squeezed longer basket names ("Bitcoin & Blue Chips") to
 * an ellipsis, and the name is the part you scan for.
 */
export function GiftRow({ gift, onClick, last }: { gift: Gift; onClick: () => void; last?: boolean }) {
  const kind = pillFor(gift);
  // "a•••@gmail.com" or "@jack" on a gift you sent; their first name on one you were sent.
  const who = gift.direction === "sent" ? gift.recipientLabel : gift.fromName;
  // The pill already says "Claimed" / "Returned" / "Ready to claim", so only a
  // gift still counting down needs the timing spelled out beside it. Timing goes
  // first: if the line has to truncate it should eat the tail of an address, not
  // the countdown. The section heading supplies the preposition the name drops.
  const when = kind === "waiting" ? untilLabel(gift.unlockAt) : null;
  const secondary = [when, who].filter(Boolean).join(" · ");
  return (
    <button
      className="row"
      onClick={onClick}
      aria-label={`${gift.basketName}, ${usd(gift.amountUsd)}, ${GIFT_PILL_LABEL[kind]}${when ? `, ${when}` : ""}`}
      style={{
        padding: "13px 0",
        minHeight: 68,
        gap: 12,
        alignItems: "flex-start",
        borderBottom: last ? "none" : "1px solid var(--line-2)",
        width: "100%",
      }}
    >
      <span style={{ display: "inline-flex", flex: "none", paddingTop: 2 }}>
        <LogoCluster assets={clusterOfGift(gift)} size={24} max={3} showRest={false} />
      </span>
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontWeight: 600,
              fontSize: 15,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {gift.basketName}
          </span>
          <span className="tnum" style={{ flex: "none", fontWeight: 700, fontSize: 15 }}>
            {usd(gift.amountUsd)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, minWidth: 0 }}>
          <StatusPill gift={gift} />
          <span
            className="tnum"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: "var(--ink-2)",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {secondary}
          </span>
        </div>
      </div>
    </button>
  );
}

const line = (i: number): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 0",
  borderTop: i ? "1px solid var(--line-2)" : "none",
});

/**
 * What the money will buy, before it buys it: dollars by weight. Used only on
 * the give flow's review card, where nothing has been bought yet.
 */
export function SplitList({
  rows,
}: {
  /** Already priced — see `reviewRows`, which knows the fee only hits the bought part. */
  rows: (GiftItem & { heldAsCash?: boolean; amountUsd: number })[];
}) {
  return (
    <div>
      {rows.map((l, i) => (
        <div key={l.symbol} style={line(i)}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500 }}>
            {toTile(l.symbol).name}
            {(l as GiftHolding).heldAsCash && (
              <span style={{ color: "var(--ink-2)", fontWeight: 500 }}> · held as cash</span>
            )}
          </span>
          <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)", flex: "none" }}>
            {Math.round(l.weightPct)}%
          </span>
          <span className="tnum" style={{ fontSize: 14, fontWeight: 700, flex: "none", minWidth: 62, textAlign: "right" }}>
            {usd(l.amountUsd)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A parked token's decimals, by address first.
 *
 * The safe slice is parked as plain USDC, which is the chain's base currency and
 * so is NOT in `assets.all` — looking it up by symbol alone fell through to a
 * default of 18 and rendered 20 dollars as "2.00e-11".
 */
function decimalsOf(chain: StaxChain, token: GiftToken): number {
  const address = token.address.toLowerCase();
  if (address === chain.usdc.address.toLowerCase()) return chain.usdc.decimals;
  const byAddress = chain.assets.all.find((a) => a.address?.toLowerCase() === address);
  return byAddress?.decimals ?? assetBySymbol(chain, token.symbol)?.decimals ?? 18;
}

/**
 * What a gift actually holds: the real quantities parked in the contract. These
 * are the amounts the swaps returned, so they are shown as quantities and never
 * converted back into dollars — the dollars would be today's guess at a past
 * purchase, and the receipt already carries what was paid.
 */
export function TokenList({ tokens, chain }: { tokens: GiftToken[]; chain: StaxChain }) {
  return (
    <div>
      {tokens.map((t, i) => {
        const decimals = decimalsOf(chain, t);
        return (
          <div key={t.address} style={line(i)}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500 }}>{toTile(t.symbol).name}</span>
            <span className="tnum" style={{ fontSize: 14, fontWeight: 700, flex: "none", textAlign: "right" }}>
              {tokenQty(BigInt(t.amount), decimals)} {t.symbol}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Why part of a basket sits as dollars. Aave's Safe Dollars rebase, and a gift
 * pays back the amount it recorded rather than the live balance, so parking the
 * aToken for up to 25 years would strand everything it earned. The dollars are
 * parked instead and the recipient can put them to work once they claim.
 */
export function CashSliceNote({ style }: { style?: CSSProperties }) {
  return (
    <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, ...style }}>
      The safe part is set aside as dollars rather than lent out, so nothing it earns can get stuck. It&apos;s
      fully theirs, and they can put it to work the moment they claim.
    </p>
  );
}

/** Basket identity: cluster, name, weight bar. Used on the review card. */
export function GiftBasketHead({ name, items }: { name: string; items: GiftItem[] }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <LogoCluster assets={clusterOfItems(items)} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 16.5,
              letterSpacing: "-.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {name}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
            {items.length} {items.length === 1 ? "holding" : "holdings"}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <RampWeightBar items={items} />
      </div>
    </div>
  );
}

/** The same head for a gift that already exists. */
export function GiftTokenHead({ name, gift }: { name: string; gift: Pick<Gift, "holdings" | "tokens"> }) {
  const count = gift.tokens.length || gift.holdings.length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <LogoCluster assets={clusterOfGift(gift)} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 16.5,
            letterSpacing: "-.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
          {count} {count === 1 ? "holding" : "holdings"}
        </div>
      </div>
    </div>
  );
}

/**
 * One question in the give flow. Answered steps stay visible and quiet; the step
 * being asked carries the accent. Reveal keys off the step's mount so a newly
 * revealed question rises in rather than appearing.
 */
export function Step({
  n,
  title,
  hint,
  answer,
  open,
  onEdit,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  /** The short form of the answer, shown once the step is behind you. */
  answer?: string;
  open: boolean;
  /** Reopen an answered step. Makes the whole header a 44px-tall target. */
  onEdit?: () => void;
  children?: ReactNode;
}) {
  const head = (
    <>
      <span
        className="tnum"
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: 99,
          flex: "none",
          display: "grid",
          placeItems: "center",
          fontSize: 12.5,
          fontWeight: 700,
          background: answer ? "var(--primary-soft)" : "var(--surface-2)",
          color: answer ? "var(--primary)" : "var(--ink-3)",
        }}
      >
        {answer ? <Icon name="check" size={14} stroke={2.6} /> : n}
      </span>
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em" }}>{title}</div>
        {hint && open && (
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.4 }}>{hint}</div>
        )}
      </div>
      {!open && answer && (
        <span
          className="tnum"
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--ink-2)",
            flex: "none",
            maxWidth: 140,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {answer}
        </span>
      )}
      {!open && onEdit && <Icon name="chevR" size={16} style={{ color: "var(--ink-3)", flex: "none" }} />}
    </>
  );
  return (
    <Reveal className="card" style={{ padding: 16, marginBottom: 10 }}>
      {!open && onEdit ? (
        <button
          onClick={onEdit}
          className="tap"
          aria-label={`Change ${title.toLowerCase()}`}
          style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", minHeight: 44 }}
        >
          {head}
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 26 }}>{head}</div>
      )}
      {open && children && <div style={{ marginTop: 14 }}>{children}</div>}
    </Reveal>
  );
}

/** A labelled line on the review card / detail sheet. */
export function DetailRow({ label, value, first }: { label: string; value: ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "11px 0",
        borderTop: first ? "none" : "1px solid var(--line-2)",
        fontSize: 14.5,
      }}
    >
      <span style={{ color: "var(--ink-2)", flex: "none" }}>{label}</span>
      <span className="tnum" style={{ fontWeight: 600, textAlign: "right", minWidth: 0 }}>
        {value}
      </span>
    </div>
  );
}

/** "Sep 7, 2031 · in 4 years" — the unlock line. */
export function UnlockLine({ iso, live = true }: { iso: string; live?: boolean }) {
  return (
    <span className="tnum">
      {unlockLocal(iso)}
      {live && <span style={{ color: "var(--ink-2)", fontWeight: 500 }}> · {untilLabel(iso)}</span>}
    </span>
  );
}

const CELL: CSSProperties = { flex: 1, textAlign: "center", minWidth: 0 };

/**
 * The wait, on a live clock.
 *
 * A date answers "when" and leaves "how long" to arithmetic, and the wait is the
 * whole substance of a locked gift. Seconds tick, so even a gift years away is
 * visibly counting rather than merely asserted. Renders nothing once the gift is
 * open, because by then the button below it is the answer.
 */
export function GiftCountdown({ iso, style }: { iso: string; style?: CSSProperties }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = countdownTo(iso, now);
  if (left.done) return null;
  const cells: { value: number; label: string }[] = [
    { value: left.days, label: left.days === 1 ? "day" : "days" },
    { value: left.hours, label: "hrs" },
    { value: left.minutes, label: "min" },
    { value: left.seconds, label: "sec" },
  ];
  // A gift opening this afternoon has no business showing "0 days".
  const shown = left.days > 0 ? cells : cells.slice(1);

  return (
    <div
      className="card"
      aria-label={`Opens in ${left.days} days, ${left.hours} hours, ${left.minutes} minutes`}
      style={{ padding: "13px 12px 12px", background: "var(--surface-2)", ...style }}
    >
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          textAlign: "center",
        }}
      >
        Opens in
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginTop: 8 }} aria-hidden>
        {shown.map((c, i) => (
          <div key={c.label} style={CELL}>
            <div
              className="tnum"
              style={{
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-.02em",
                lineHeight: 1.1,
                // The last cell is the one that moves; the rest are context.
                color: i === shown.length - 1 ? "var(--ink-2)" : "var(--ink)",
              }}
            >
              {c.value < 10 && i > 0 ? `0${c.value}` : c.value}
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-3)", marginTop: 3 }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
