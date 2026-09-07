"use client";

// The public face of a gift. This page is a LINK anyone might open, so it lives
// in the marketing world (SiteFrame + Nav + the `--s-*` tokens), not the app
// shell, and it shows only what the preview reader returns: the basket's symbols
// and weights, but no email, no addresses and no token amounts.
import Link from "next/link";
import { Nav } from "@/components/site/Nav";
import { SiteFrame } from "@/components/site/SiteFrame";
import { toTile } from "@/lib/displayAssets";
import { appUrl, siteUrl } from "@/lib/urls";
import { unlockDate } from "@/components/lite/gift/giftFormat";
import type { GiftPreview } from "@/components/lite/gift/types";
import L from "@/components/site/layout.module.css";
import s from "./GiftShare.module.css";

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** The basket's holdings, heaviest first. Empty on rows written before snapshots. */
function symbolsFor(preview: GiftPreview): string[] {
  return [...preview.holdings].sort((a, b) => b.weightPct - a.weightPct).map((h) => h.symbol);
}

/** Asset tiles, styled for the site scope (the app's cluster needs `.stax`). */
function Tiles({ symbols }: { symbols: string[] }) {
  const shown = symbols.slice(0, 4);
  const rest = symbols.length - shown.length;
  return (
    <div className={s.tiles} role="img" aria-label={shown.map((x) => toTile(x).name).join(", ")}>
      {shown.map((symbol) => {
        const t = toTile(symbol);
        return (
          <span key={symbol} className={s.tile} style={{ background: t.logo ? "#fff" : t.color }}>
            {t.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote CDN logo, no Image loader
              <img src={t.logo} alt="" width={52} height={52} />
            ) : (
              <span className={s.glyph}>{t.kind === "safe" ? "$" : (t.glyph || t.name[0]).toUpperCase()}</span>
            )}
          </span>
        );
      })}
      {rest > 0 && <span className={`${s.tile} ${s.rest}`}>+{rest}</span>}
    </div>
  );
}

export function GiftSharePage({ preview }: { preview: GiftPreview | null }) {
  if (!preview) {
    return (
      <SiteFrame>
        <Nav />
        <main className={s.main}>
          <div className={L.wrap}>
            <div className={s.card}>
              <h1 className={s.title}>This gift link isn&apos;t available</h1>
              <p className={s.lead}>
                It may have been opened already, or the link may be incomplete. Ask whoever sent it to share it
                again.
              </p>
              <Link href={siteUrl("/")} className={s.cta}>
                See what Stax is
              </Link>
            </div>
          </div>
        </main>
      </SiteFrame>
    );
  }

  const giver = preview.fromName;
  const settled = preview.status === "claimed" || preview.status === "reclaimed";
  const symbols = symbolsFor(preview);

  return (
    <SiteFrame>
      <Nav />
      <main className={s.main}>
        <div className={L.wrap}>
          <div className={s.card}>
            <p className={s.eyebrow}>A gift on Stax</p>

            <h1 className={s.title}>
              {giver ? `${giver} sent you ` : "You've been sent "}
              <span className={s.amount}>{money(preview.amountUsd)}</span> of {preview.basketName}
            </h1>

            {symbols.length > 0 && <Tiles symbols={symbols} />}

            {preview.note && <blockquote className={s.note}>“{preview.note}”</blockquote>}

            <p className={s.when}>
              {preview.status === "claimed"
                ? "This one has already been opened."
                : preview.status === "reclaimed"
                  ? "This one went back to the person who sent it."
                  : preview.claimable
                    ? "Ready now — it's waiting for you."
                    : `Held safely until ${unlockDate(preview.unlockAt)}.`}
            </p>

            <p className={s.lead}>
              The money is already invested in {preview.basketName}, a mix of real companies. It stays invested while
              it waits, and only you can open it.
            </p>

            {!settled && (
              <>
                <a href={appUrl(`?gift=${encodeURIComponent(preview.id)}`)} className={s.cta}>
                  Open in Stax
                </a>
                <p className={s.fine}>Sign in with the email it was sent to. No fees to open it.</p>
              </>
            )}
          </div>

          <nav aria-label="Footer" className={s.foot}>
            <Link href={siteUrl("/")}>Home</Link>
            <Link href={siteUrl("/demo")}>Demo</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <span className={s.copy}>© 2026 Stax</span>
          </nav>
        </div>
      </main>
    </SiteFrame>
  );
}
