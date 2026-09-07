"use client";

// One gift, opened. The note first (it's the part that matters), then what it
// actually holds, who it's between, when it opens, and the permanent record —
// followed by the single action this gift allows right now.
import { BottomSheet, Icon, Seal, useToast } from "@/components/design";
import { HoldButton } from "@/components/motion";
import { useClaimGift, useReclaimGift } from "@/hooks/useGifts";
import { usd, txUrl } from "@/lib/format";
import { useChain } from "@/lib/chains/active";
import { haptic } from "@/lib/haptics";
import { DetailRow, GiftTokenHead, SplitList, StatusPill, TokenList } from "./giftPrimitives";
import { giftShareUrl, unlockDate, untilLabel } from "./giftFormat";
import { pillFor, type Gift } from "./types";

export function GiftDetailSheet({ gift, onClose }: { gift: Gift | null; onClose: () => void }) {
  const chain = useChain();
  const { notify } = useToast();
  const claim = useClaimGift();
  const reclaim = useReclaimGift();

  const busy = claim.isPending || reclaim.isPending;
  const kind = gift ? pillFor(gift) : "waiting";
  const txHash = gift?.claimTxHash ?? gift?.createTxHash ?? null;
  const explorerHref = txHash ? txUrl(txHash, chain) : undefined;

  const copyLink = async () => {
    if (!gift) return;
    haptic.light();
    try {
      await navigator.clipboard.writeText(gift.shareUrl ?? giftShareUrl(gift.id));
      notify("Gift link copied", "link");
    } catch {
      notify("Couldn't copy the link. Try again.", "info");
    }
  };

  const onClaim = () => {
    if (!gift) return;
    haptic.medium();
    claim.mutate(gift.id, {
      onSuccess: () => {
        notify(`${gift.basketName} is yours`, "check");
        onClose();
      },
      onError: (e) => notify(e instanceof Error ? e.message : "That didn't go through.", "info"),
    });
  };

  const onReclaim = () => {
    if (!gift) return;
    haptic.medium();
    reclaim.mutate(gift.id, {
      onSuccess: () => {
        notify("Back in your account", "check");
        onClose();
      },
      onError: (e) => notify(e instanceof Error ? e.message : "That didn't go through.", "info"),
    });
  };

  return (
    <BottomSheet open={Boolean(gift)} onClose={onClose} title={gift ? gift.basketName : "Gift"}>
      {gift && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <StatusPill gift={gift} />
          </div>

          {gift.note && (
            <div className="card" style={{ padding: 16, marginBottom: 12, background: "var(--surface-2)" }}>
              <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55, fontStyle: "italic" }}>“{gift.note}”</p>
              {gift.fromName && (
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 8, fontWeight: 600 }}>
                  — {gift.fromName}
                </div>
              )}
            </div>
          )}

          {(gift.tokens.length > 0 || gift.holdings.length > 0) && (
            <div className="card" style={{ padding: 16 }}>
              <GiftTokenHead name={gift.basketName} gift={gift} />
              {/* Real quantities once it is parked; the split as given before that. */}
              <div style={{ marginTop: 12, paddingTop: 4, borderTop: "1px solid var(--line-2)" }}>
                {gift.tokens.length > 0 ? (
                  <TokenList tokens={gift.tokens} chain={chain} />
                ) : (
                  <SplitList items={gift.holdings} amountUsd={gift.amountUsd} />
                )}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: "4px 16px", marginTop: 12 }}>
            <DetailRow first label="Worth when sent" value={usd(gift.amountUsd)} />
            <DetailRow
              label={gift.direction === "sent" ? "For" : "From"}
              value={(gift.direction === "sent" ? gift.recipientEmailMasked : gift.fromName) ?? "—"}
            />
            <DetailRow
              label={
                kind === "claimed" ? "Opened" : kind === "returned" ? "Was to open" : kind === "ready" ? "Unlocked" : "Opens"
              }
              value={
                <span className="tnum">
                  {unlockDate(gift.unlockAt)}
                  {kind === "waiting" && (
                    <span style={{ color: "var(--ink-2)", fontWeight: 500 }}> · {untilLabel(gift.unlockAt)}</span>
                  )}
                </span>
              }
            />
            <DetailRow label="Network" value={chain.name} />
          </div>

          {/* what's true right now, in plain words */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "14px 4px 0" }}>
            <Seal size={20} />
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {kind === "waiting" &&
                (gift.direction === "sent"
                  ? `Invested and held safely until ${unlockDate(gift.unlockAt)}. Nobody can spend it before then, including you.`
                  : `Already invested for you. You can open it on ${unlockDate(gift.unlockAt)}.`)}
              {kind === "ready" &&
                (gift.direction === "sent"
                  ? "Waiting for them to open it. It stays invested until they do."
                  : "It's yours to open. The holdings move into your account.")}
              {kind === "claimed" && "Opened. The holdings sit in the recipient's account now."}
              {kind === "returned" && "Nobody claimed it, so it came back to your account."}
              {kind === "preparing" && "Still being set up. The share link appears once it’s safely put away."}
              {kind === "failed" && "This one didn't go through, so nothing was taken."}
            </p>
          </div>

          {explorerHref && (
            <a
              href={explorerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-glass btn-block tap"
              style={{ height: 46, fontSize: 14.5, textDecoration: "none", marginTop: 14 }}
            >
              View on {chain.explorer.name} <Icon name="arrowUR" size={16} />
            </a>
          )}

          {/* the one thing to do */}
          <div style={{ marginTop: 12 }}>
            {gift.direction === "received" && gift.claimable && (
              <HoldButton onComplete={onClaim} disabled={busy} className="btn-lg">
                {claim.isPending ? "Opening…" : `Hold to claim ${usd(gift.amountUsd)}`}
              </HoldButton>
            )}
            {gift.direction === "sent" && (kind === "waiting" || kind === "ready") && (
              <button className="btn btn-primary btn-block btn-lg tap" onClick={copyLink}>
                <Icon name="copy" size={18} /> Copy gift link
              </button>
            )}
            {gift.direction === "sent" && gift.reclaimable && (
              <button
                className="btn btn-ghost btn-block tap"
                style={{ marginTop: 10, minHeight: 46 }}
                onClick={onReclaim}
                disabled={busy}
              >
                {reclaim.isPending ? "Bringing it back…" : "Return it to me"}
              </button>
            )}
            {gift.direction === "received" && !gift.claimable && kind === "waiting" && (
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", textAlign: "center", lineHeight: 1.45 }}>
                Come back on {unlockDate(gift.unlockAt)} and you can open it.
              </p>
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
