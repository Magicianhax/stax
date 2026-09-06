"use client";

// Private-beta gate — what a signed-in but not-yet-approved person sees
// instead of the app. The same card as /beta (position, link + copy, share,
// referral count) in the app's own design system, "try the demo", "Sign out".
// No tabs, no other navigation. Joins the list on first sight (useBetaJoin).
import { useEffect, useRef, useState } from "react";
import { useLogout } from "@privy-io/react-auth";
import { Check, Copy, Share2 } from "lucide-react";
import { Icon, StaxWordmark, useToast } from "@/components/design";
import { useBetaJoin, type Access } from "@/hooks/useBetaAccess";
import { betaShareText, copyText, shareLinks, useNativeShare } from "@/lib/referral";
import { haptic } from "@/lib/haptics";
import { TelegramMark, WhatsAppMark, XMark } from "@/components/site/beta/marks";

function Spinner() {
  return (
    <span
      className="spin"
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        border: "2.4px solid color-mix(in srgb, currentColor 35%, transparent)",
        borderTopColor: "currentColor",
        display: "inline-block",
        flex: "none",
      }}
    />
  );
}

const shareBtn: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  height: 48,
  padding: "0 8px",
  borderRadius: 16,
  gap: 7,
  fontSize: 13.5,
  fontWeight: 600,
};

export function BetaGateScreen({
  access,
  error,
  onRetry,
}: {
  access: Access | null;
  error: string | null;
  onRetry: () => void;
}) {
  const { logout } = useLogout();
  const { notify } = useToast();
  const { joining, joinError, retryJoin } = useBetaJoin(access);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const native = useNativeShare();

  useEffect(() => {
    document.title = "Private beta · Stax";
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const url = access?.referralUrl ?? null;
  const links = url ? shareLinks(url) : null;

  const copy = async () => {
    if (!url) return;
    const ok = await copyText(url);
    if (!ok) return;
    haptic.select();
    notify("Copied", "check");
    setCopied(true);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  const share = () => {
    if (!url) return;
    void navigator.share({ text: betaShareText(url) }).catch(() => {});
  };

  const failure = error ?? joinError;
  const retry = () => (joinError ? retryJoin() : onRetry());
  const pending = !failure && (!access || joining || access.status === "none");

  let body: React.ReactNode;
  if (failure) {
    body = (
      <div className="card" style={{ padding: 22 }} role="alert">
        <p className="body" style={{ margin: 0 }}>Couldn&apos;t load your place. {failure}</p>
        <button className="btn btn-outline tap" style={{ height: 48, marginTop: 14 }} onClick={retry}>
          Try again
        </button>
      </div>
    );
  } else if (pending) {
    body = (
      <div className="card" style={{ padding: 22, display: "flex", alignItems: "center", gap: 12 }} aria-busy="true">
        <Spinner />
        <span className="body" style={{ color: "var(--ink)" }}>{access ? "Saving your place…" : "Checking your place…"}</span>
      </div>
    );
  } else if (access && access.status === "blocked") {
    body = (
      <div className="card" style={{ padding: 22 }}>
        <p className="body" style={{ margin: 0 }}>This account can&apos;t join right now.</p>
      </div>
    );
  } else if (access) {
    body = (
      <div className="card" style={{ padding: "22px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span
            className="serif tnum"
            style={{ fontSize: 64, lineHeight: 0.95, letterSpacing: "-0.04em", color: "var(--ink)" }}
          >
            {access.position !== null ? `#${access.position.toLocaleString("en-US")}` : "—"}
          </span>
          <span className="body tnum" style={{ fontWeight: 600 }}>of {access.waiting.toLocaleString("en-US")} waiting</span>
        </div>

        {url && links && (
          <>
            <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
              <div
                className="field mono"
                title={url}
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  height: 48,
                  padding: "0 14px",
                  fontSize: 13,
                  color: "var(--ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  direction: "rtl",
                  textAlign: "left",
                }}
              >
                <span style={{ direction: "ltr", unicodeBidi: "isolate" }}>{url.replace(/^https?:\/\//, "")}</span>
              </div>
              <button
                className="btn btn-primary tap"
                style={{ height: 48, padding: "0 16px", borderRadius: 16, fontSize: 14.5, gap: 7, flex: "none" }}
                onClick={copy}
                aria-live="polite"
              >
                {copied ? <Check size={16} strokeWidth={2.6} aria-hidden="true" /> : <Copy size={16} strokeWidth={2.2} aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 8 }} aria-label="Share your link">
              <a className="btn btn-outline tap" style={shareBtn} href={links.x} target="_blank" rel="noopener noreferrer">
                <XMark size={15} />
                Post
              </a>
              <a className="btn btn-outline tap" style={shareBtn} href={links.whatsapp} target="_blank" rel="noopener noreferrer">
                <WhatsAppMark size={16} />
                WhatsApp
              </a>
              <a className="btn btn-outline tap" style={shareBtn} href={links.telegram} target="_blank" rel="noopener noreferrer">
                <TelegramMark size={16} />
                Telegram
              </a>
              {native && (
                <button className="btn btn-outline tap" style={{ ...shareBtn, flex: "0 0 48px", padding: 0 }} onClick={share} aria-label="Share">
                  <Share2 size={16} strokeWidth={2.2} aria-hidden="true" />
                </button>
              )}
            </div>
          </>
        )}

        <div>
          <p className="body" style={{ margin: 0 }}>Every friend who joins with your link moves you up.</p>
          <p className="body tnum" style={{ margin: "6px 0 0", fontWeight: 700, color: "var(--ink)" }}>
            {access.referrals.toLocaleString("en-US")} {access.referrals === 1 ? "friend" : "friends"} joined
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen screen-pad-top" style={{ justifyContent: "space-between" }}>
      <div style={{ padding: "30px 22px 0" }}>
        <div className="anim-rise" style={{ marginBottom: 34 }}>
          <StaxWordmark size={28} />
        </div>
        <div className="anim-rise" style={{ animationDelay: ".05s" }}>
          <h1 className="display-xl" style={{ margin: 0 }}>
            You&apos;re on
            <br />
            the list.
          </h1>
          <p className="body" style={{ marginTop: 16, fontSize: 16, maxWidth: 320 }}>
            Stax is in private beta. We let people in a few at a time.
          </p>
        </div>
        <div className="anim-rise" style={{ animationDelay: ".12s", marginTop: 26 }}>
          {body}
        </div>
      </div>

      <div className="anim-rise" style={{ animationDelay: ".18s", padding: "20px 22px calc(26px + env(safe-area-inset-bottom))" }}>
        <a className="btn btn-glass btn-block tap" href="/demo">
          While you wait, try the demo
          <Icon name="chevR" size={18} style={{ color: "var(--ink-3)" }} />
        </a>
        <button
          className="tap"
          style={{ display: "block", width: "100%", minHeight: 44, marginTop: 10, fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}
          onClick={() => {
            haptic.select();
            void logout();
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
