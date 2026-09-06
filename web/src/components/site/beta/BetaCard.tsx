"use client";

// The waitlist card on /beta, rendered once the person is signed in. One
// component, five states: joining (first sign-in, the join request is in
// flight), waiting (position, link, share, count), approved ("You're in"),
// blocked (one calm line), error (what failed + retry).
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import type { Access } from "@/lib/beta";
import { copyText } from "@/lib/referral";
import { NumberTicker } from "@/components/site/ui/NumberTicker";
import { ShineButton } from "@/components/site/ui/ShineButton";
import { ShareRow } from "./ShareRow";
import s from "./Beta.module.css";

const rank = (n: number) => `#${Math.round(n).toLocaleString("en-US")}`;

export function BetaCard({
  access,
  joining,
  error,
  onRetry,
}: {
  access: Access | null;
  joining: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className={s.card} role="alert">
        <p className={s.calm}>Couldn&apos;t load your place. {error}</p>
        <button type="button" className={s.retry} onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (!access || joining || access.status === "none") {
    return (
      <div className={s.card} aria-busy="true">
        <p className={s.pending}>
          <span className={s.spin} aria-hidden="true" />
          {access ? "Saving your place…" : "Checking your place…"}
        </p>
      </div>
    );
  }

  if (access.status === "approved") {
    return (
      <div className={s.card}>
        <h2 className={s.title}>You&apos;re in.</h2>
        <div className={s.ctaRow}>
          <ShineButton href="/app">
            Open Stax
            <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
          </ShineButton>
        </div>
      </div>
    );
  }

  if (access.status === "blocked") {
    return (
      <div className={s.card}>
        <p className={s.calm}>This account can&apos;t join right now.</p>
      </div>
    );
  }

  return (
    <div className={s.card}>
      <div className={s.position}>
        <NumberTicker value={access.position} format={rank} className={s.rank} />
        <span className={s.of}>of {access.waiting.toLocaleString("en-US")} waiting</span>
      </div>

      {access.referralUrl && (
        <>
          <ReferralLink url={access.referralUrl} />
          <ShareRow url={access.referralUrl} />
        </>
      )}

      <p className={s.note}>Every friend who joins with your link moves you up.</p>
      <p className={s.friends}>
        {access.referrals.toLocaleString("en-US")} {access.referrals === 1 ? "friend" : "friends"} joined
      </p>
    </div>
  );
}

/** Mono field with the link, tail-anchored so the code stays visible, plus Copy. */
export function ReferralLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    const ok = await copyText(url);
    if (!ok) return;
    setDone(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1800);
  };

  return (
    <div className={s.linkRow}>
      <div className={s.field} title={url}>
        <span>{url.replace(/^https?:\/\//, "")}</span>
      </div>
      <button type="button" className={s.copyBtn} onClick={copy} data-done={done || undefined} aria-live="polite">
        {done ? <Check size={16} strokeWidth={2.6} aria-hidden="true" /> : <Copy size={16} strokeWidth={2.2} aria-hidden="true" />}
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
