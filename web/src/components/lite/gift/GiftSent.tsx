"use client";

// The gift is sent — the receipt moment. Same anatomy as ReceiptScreen (hero with
// a drawn check, the amount counting in, the fills, then the permanent record) so
// sending a gift feels like every other thing Stax finishes for you, with one
// difference: the primary action here is handing over the link.
import { useState } from "react";
import { Icon, LogoCluster, Seal, useToast } from "@/components/design";
import { Burst, DrawCheck, Money, Reveal } from "@/components/motion";
import { usd } from "@/lib/format";
import { useChain } from "@/lib/chains/active";
import { haptic } from "@/lib/haptics";
import { clusterOfTokens, DetailRow, TokenList } from "./giftPrimitives";
import { giftShareUrl, unlockDate, untilLabel } from "./giftFormat";
import type { SentGift } from "@/hooks/useGifts";

export function GiftSent({
  gift,
  amountUsd,
  feeUsd,
  onDone,
}: {
  gift: SentGift;
  /** What the giver paid, fee included. */
  amountUsd: number;
  feeUsd: number;
  onDone: () => void;
}) {
  const chain = useChain();
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const url = giftShareUrl(gift.id);

  const copy = async () => {
    haptic.light();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      notify("Gift link copied", "link");
      setTimeout(() => setCopied(false), 2200);
    } catch {
      notify("Couldn't copy the link. Try again.", "info");
    }
  };

  const share = async () => {
    haptic.light();
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share && /Android|iPhone|iPad/i.test(nav.userAgent)) {
      try {
        await nav.share({
          title: "A gift on Stax",
          text: `I sent you ${usd(amountUsd)} of ${gift.basketName}.`,
          url,
        });
        return;
      } catch {
        /* dismissed — leave the copy button to do the job */
      }
    }
    await copy();
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 30 }}>
      {/* hero */}
      <Reveal style={{ position: "relative", padding: "26px 22px 0", textAlign: "center" }}>
        <Burst fire />
        <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 14px" }}>
          <div style={{ display: "grid", placeItems: "center", height: 64 }}>
            <LogoCluster assets={clusterOfTokens(gift.tokens)} size={34} max={4} />
          </div>
          <span
            className="receipt-hero"
            style={{ position: "absolute", right: -8, bottom: -6, padding: 2, borderRadius: "50%", display: "grid" }}
          >
            <DrawCheck size={26} delay={0.25} />
          </span>
        </div>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.015em", lineHeight: 1.1 }}>
          Your gift is on its way
        </h1>
        <div style={{ marginTop: 8 }}>
          <Money value={amountUsd} prev={0} size={34} style={{ fontWeight: 700, letterSpacing: "-.02em" }} />
        </div>
        <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 4 }}>
          {gift.basketName} · for {gift.recipientEmailMasked}
        </div>
      </Reveal>

      {/* the link — the thing they came here for */}
      <Reveal delay={0.12} style={{ padding: "22px 22px 0" }}>
        <button className="btn btn-primary btn-block btn-lg tap" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={18} /> {copied ? "Copied" : "Copy gift link"}
        </button>
        <button className="btn btn-ghost btn-block tap" style={{ marginTop: 10, minHeight: 46 }} onClick={share}>
          <Icon name="send" size={17} /> Share it
        </button>
        <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "12px 0 0", lineHeight: 1.5, textAlign: "center" }}>
          They&apos;ll need to sign in with {gift.recipientEmailMasked} to open it. Only they can.
        </p>
      </Reveal>

      {/* what was bought and parked for them */}
      {gift.tokens.length > 0 && (
        <Reveal delay={0.18} style={{ padding: "20px 22px 0" }}>
          <div className="card" style={{ padding: "4px 18px" }}>
            <TokenList tokens={gift.tokens} chain={chain} />
          </div>
        </Reveal>
      )}

      {/* details */}
      <Reveal delay={0.24} style={{ padding: "12px 22px 0" }}>
        <div className="card" style={{ padding: "4px 18px" }}>
          <DetailRow
            first
            label="Opens"
            value={
              <span className="tnum">
                {unlockDate(gift.unlockAtIso)}
                <span style={{ color: "var(--ink-2)", fontWeight: 500 }}> · {untilLabel(gift.unlockAtIso)}</span>
              </span>
            }
          />
          {gift.note && <DetailRow label="Your note" value={<span style={{ fontWeight: 500 }}>“{gift.note}”</span>} />}
          <DetailRow label="Fee" value={`${usd(feeUsd)} · gas on us`} />
          <DetailRow label="You paid" value={usd(amountUsd)} />
          <DetailRow label="Network" value={chain.name} />
        </div>
      </Reveal>

      {/* permanent record */}
      <Reveal delay={0.3} style={{ padding: "12px 22px 0" }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Seal size={24} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: "-.01em" }}>Held safely until then</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Recorded on {chain.name}</div>
            </div>
          </div>
          <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "12px 0 0", lineHeight: 1.55 }}>
            The money is already invested and set aside for them. Nobody can spend it in the meantime, not even you,
            and on {unlockDate(gift.unlockAtIso)} they can claim it from their own account. If they never do, you can
            take it back three months later.
          </p>
        </div>
      </Reveal>

      <div style={{ padding: "18px 22px 0" }}>
        <button className="btn btn-ghost btn-block tap" style={{ minHeight: 48 }} onClick={onDone}>
          See your gifts
        </button>
      </div>
    </div>
  );
}
