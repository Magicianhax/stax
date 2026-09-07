"use client";

// Not a consent banner: Stax sets no tracking cookies (Vercel Analytics is
// cookieless; Privy uses cookies/localStorage only for sign-in), so this is a
// one-line notice with a Privacy link. Shows 1.5 s after the landing mounts
// and never again once dismissed (localStorage `stax:cookie-notice`).
// Mounted from SiteLanding only, not the root layout.
import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import s from "./CookieNotice.module.css";

const KEY = "stax:cookie-notice";
const DELAY_MS = 1500;

function dismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function CookieNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (dismissed()) return;
    const t = window.setTimeout(() => setOpen(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // private mode; the notice simply shows again next visit
    }
  };

  if (!open) return null;

  return (
    <div className={s.notice} role="status" aria-live="polite">
      <p className={s.text}>
        <b>We use cookies only to keep you signed in.</b> No trackers.{" "}
        <Link href="/privacy" className={s.link}>
          Privacy
        </Link>
      </p>
      <button type="button" className={s.close} onClick={close} aria-label="Dismiss cookie notice">
        <X size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
