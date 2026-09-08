// Referral plumbing for the private beta (docs/BETA.md).
//
//   captureRef()      read `?ref=CODE` off the current URL, keep it in
//                     localStorage["stax.ref"], strip it from the address bar
//   getRef()/clearRef() the stored code, consumed once by POST /api/beta/join
//   captureInvite()   the same for `?code=CODE`, an invite that skips the queue.
//                     It has to survive the sign-in round trip, which is why it
//                     is stashed rather than read straight off the URL.
//   betaShareText(url) the prefilled post for the share row
//   shareLinks(url)   X / WhatsApp / Telegram intent URLs for that text
//
// Codes are 8-char base62 (see the schema), but the capture only checks the
// shape loosely; the server decides whether a code is real.

import { useSyncExternalStore } from "react";

const KEY = "stax.ref";
const INVITE_KEY = "stax.invite";
const SHAPE = /^[A-Za-z0-9]{4,16}$/;

function capture(param: string, key: string): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(param);
    if (!value) return;
    url.searchParams.delete(param);
    window.history.replaceState(window.history.state, "", url.toString());
    if (SHAPE.test(value)) window.localStorage.setItem(key, value);
  } catch {
    // URL or storage unavailable (private mode); nothing to keep.
  }
}

function stored(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    return v && SHAPE.test(v) ? v : null;
  } catch {
    return null;
  }
}

function forget(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function captureRef(): void {
  capture("ref", KEY);
}

export function getRef(): string | null {
  return stored(KEY);
}

export function clearRef(): void {
  forget(KEY);
}

/** `?code=` on the beta page or an invite link: the code that skips the queue. */
export function captureInvite(): void {
  capture("code", INVITE_KEY);
}

export function getInvite(): string | null {
  return stored(INVITE_KEY);
}

export function clearInvite(): void {
  forget(INVITE_KEY);
}

export function betaShareText(url: string): string {
  return `I'm on the list for Stax, real stocks in one sentence. Skip the line: ${url}`;
}

export function shareLinks(url: string): { x: string; whatsapp: string; telegram: string } {
  const text = betaShareText(url);
  return {
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
      "I'm on the list for Stax, real stocks in one sentence. Skip the line:",
    )}`,
  };
}

/** Copy `text` to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const noopSubscribe = () => () => {};
/** True once mounted in a browser that offers a native share sheet; false on the server. */
export function useNativeShare(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
}
