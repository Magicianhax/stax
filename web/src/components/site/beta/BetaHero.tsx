"use client";

// /beta first viewport: the line, one sentence, the live counts, then either
// the login button (signed out) or the waitlist card (signed in). Signing in
// joins the list automatically (useBetaJoin) and the card takes over in place.
// Spam: a hidden "website" honeypot (rejected server-side if filled) and a 2 s
// minimum time on the page before the sign-in opens. No captcha.
import { useEffect, useRef, useState } from "react";
import { useLogin, useModalStatus, usePrivy } from "@privy-io/react-auth";
import { useBetaAccess, useBetaJoin, useBetaStats, useRedeemInvite } from "@/hooks/useBetaAccess";
import { DotField } from "@/components/site/ui/DotField";
import { NumberTicker } from "@/components/site/ui/NumberTicker";
import { Reveal } from "@/components/site/ui/Reveal";
import { ShineButton } from "@/components/site/ui/ShineButton";
import L from "@/components/site/layout.module.css";
import { BetaCard } from "./BetaCard";
import s from "./Beta.module.css";

const MIN_TIME_ON_PAGE_MS = 2000;

export function BetaHero() {
  const { ready, authenticated } = usePrivy();
  const { stats } = useBetaStats();
  const { access, loading, error, refresh } = useBetaAccess();
  const honeypot = useRef<HTMLInputElement>(null);
  const { joining, joinError, retryJoin } = useBetaJoin(access, {
    honeypot: () => honeypot.current?.value ?? "",
  });
  const { redeem, redeeming, redeemError, clearError } = useRedeemInvite(access);
  const mountedAt = useRef(0);
  const delay = useRef<number | null>(null);
  useEffect(() => {
    mountedAt.current = Date.now();
    return () => {
      if (delay.current) window.clearTimeout(delay.current);
    };
  }, []);

  const [signing, setSigning] = useState(false);
  const { login } = useLogin({
    onComplete: () => setSigning(false),
    onError: () => setSigning(false),
  });
  // Dismissing the Privy modal fires neither callback; clear the spinner when it closes.
  const { isOpen } = useModalStatus();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      setSigning(false);
    }
  }, [isOpen]);

  const onJoin = () => {
    if (!ready || signing) return;
    if (honeypot.current?.value) return;
    setSigning(true);
    const open = () => login({ loginMethods: ["email", "google", "twitter", "wallet"] });
    // A person takes longer than 2 s to read the page; a script does not.
    const wait = MIN_TIME_ON_PAGE_MS - (Date.now() - mountedAt.current);
    if (wait > 0) delay.current = window.setTimeout(open, wait);
    else open();
  };

  const cardError = error ?? joinError;
  const onRetry = () => {
    if (joinError) retryJoin();
    else refresh();
  };

  return (
    <section className={`${L.sec} ${s.hero}`} aria-labelledby="beta-title">
      <DotField />
      <div className={`${L.wrap} ${L.grid} ${s.grid}`}>
        <Reveal className={s.intro} stagger={0.08}>
          <h1 id="beta-title" className={s.h1}>
            Stax is in private beta.
          </h1>
          <p className={s.sub}>Sign in to hold a place. Bring friends to move up the line.</p>
          <p className={s.live}>
            <span>
              <b>
                <NumberTicker value={stats ? stats.waiting : null} />
              </b>{" "}
              waiting
            </span>
            <span className={s.liveSep} aria-hidden="true">
              ·
            </span>
            <span>
              <b>
                <NumberTicker value={stats ? stats.approved : null} />
              </b>{" "}
              in
            </span>
          </p>

          {!authenticated && (
            <form className={s.action} onSubmit={(e) => e.preventDefault()}>
              <div className={s.honeypot} aria-hidden="true">
                <label htmlFor="beta-website">Website</label>
                <input ref={honeypot} id="beta-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
              </div>
              <ShineButton onClick={onJoin} disabled={signing}>
                {signing ? "Opening sign-in…" : "Continue with email, Google, X or a wallet"}
              </ShineButton>
            </form>
          )}
        </Reveal>

        {ready && authenticated && (
          <div className={s.cardCol}>
            <BetaCard
              access={access}
              joining={loading || joining}
              error={cardError}
              onRetry={onRetry}
              invite={{ redeem, redeeming, error: redeemError, clearError }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
