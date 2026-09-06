// Referral plumbing for the private beta (docs/BETA.md).
//
//   captureRef()      read `?ref=CODE` off the current URL, keep it in
//                     localStorage["stax.ref"], strip it from the address bar
//   getRef()/clearRef() the stored code, consumed once by POST /api/beta/join
//   betaShareText(url) the prefilled post for the share row
//   shareLinks(url)   X / WhatsApp / Telegram intent URLs for that text
//
// Codes are 8-char base62 (see the schema), but the capture only checks the
// shape loosely; the server decides whether a code is real.

import { useSyncExternalStore } from "react";

const KEY = "stax.ref";
const SHAPE = /^[A-Za-z0-9]{4,16}$/;

export function captureRef(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref");
    if (!ref) return;
    url.searchParams.delete("ref");
    window.history.replaceState(window.history.state, "", url.toString());
    if (SHAPE.test(ref)) window.localStorage.setItem(KEY, ref);
  } catch {
    // URL or storage unavailable (private mode); nothing to keep.
  }
}

export function getRef(): string | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && SHAPE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearRef(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
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
