"use client";

// Share row for the referral link: X, WhatsApp, Telegram, and the device's
// own share sheet when the browser offers one. Each target is a 46px pill.
import { Share2 } from "lucide-react";
import { betaShareText, shareLinks, useNativeShare } from "@/lib/referral";
import { TelegramMark, WhatsAppMark, XMark } from "./marks";
import s from "./Beta.module.css";

export function ShareRow({ url }: { url: string }) {
  const links = shareLinks(url);
  const native = useNativeShare();

  const share = () => {
    void navigator.share({ text: betaShareText(url) }).catch(() => {});
  };

  return (
    <div className={s.share} aria-label="Share your link">
      <a className={s.shareBtn} href={links.x} target="_blank" rel="noopener noreferrer">
        <XMark size={16} />
        Post
      </a>
      <a className={s.shareBtn} href={links.whatsapp} target="_blank" rel="noopener noreferrer">
        <WhatsAppMark size={17} />
        WhatsApp
      </a>
      <a className={s.shareBtn} href={links.telegram} target="_blank" rel="noopener noreferrer">
        <TelegramMark size={17} />
        Telegram
      </a>
      {native && (
        <button type="button" className={s.shareBtn} onClick={share}>
          <Share2 size={16} strokeWidth={2.2} aria-hidden="true" />
          More
        </button>
      )}
    </div>
  );
}
