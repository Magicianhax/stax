"use client";

// Two separate wins at the Mantle Turing Test Hackathon 2026, as two identical
// 6+6 cards. Each card is one link to the announcement post: the award row
// (rosette, name, event), then the post itself with verbatim text from
// @Mantle_Official on July 10, 2026, clamped to five lines with the full text
// in the title attribute. Under them, one quiet line that Stax on BNB Chain is
// built for the BNB Hack: Tokenized Stocks Edition, an entry, not a win.
import { Reveal } from "@/components/site/ui/Reveal";
import L from "@/components/site/layout.module.css";
import { HACK_LINE } from "@/lib/site/landing";
import s from "./Awards.module.css";

export const AWARD_EVENT = "Mantle Turing Test Hackathon 2026";
export const AWARD_DATE = "July 10, 2026";

export const AWARDS = [
  {
    name: "Track Winner · Trading & Strategy",
    href: "https://x.com/Mantle_Official/status/2075596029408514552",
    /** Shown on the card: trimmed verbatim, the handle list elided. */
    text: [
      "The Track Winners, one from each of the six → @stax_market … From autonomous trading to agentic economies and consumer apps, these builds led their categories start to finish.",
    ],
    /** The complete post, for the title attribute. */
    full: "The Track Winners, one from each of the six. → @stax_market → @Madhav__28 → @RZ1989sol → @0x___eth → @rookie_of_ph → @MeLikeFishes. From autonomous trading to agentic economies and consumer apps, these builds led their categories start to finish.",
  },
  {
    name: "Best UI/UX",
    href: "https://x.com/Mantle_Official/status/2075596047746027814",
    text: [
      "Best UI/UX: Stax @stax_market",
      "Most onchain apps hand you a manual. Stax hands you an app you already know how to use, clear hierarchy, full design language, and onboarding with zero friction.",
      "The kind of design that turns a build into something people actually use.",
    ],
    full: null,
  },
] as const;

/** The award rosette (same drawing as /brand/awards/mark.svg), in currentColor. */
export function AwardMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6.5 5.5c-2.2 2.6-2.4 6.6-.4 9.6 1 1.5 2.4 2.6 4 3.2" />
      <path d="M17.5 5.5c2.2 2.6 2.4 6.6.4 9.6-1 1.5-2.4 2.6-4 3.2" />
      <path d="M6.2 9.2c1.6-.2 3 .3 4 1.4M17.8 9.2c-1.6-.2-3 .3-4 1.4M7 13.2c1.5 0 2.9.7 3.8 1.9M17 13.2c-1.5 0-2.9.7-3.8 1.9" />
      <circle cx="12" cy="9" r="3.1" />
      <path d="M12 12.2v8.3" />
    </svg>
  );
}

/** The X mark, drawn inline so no third-party script or image is loaded. */
function XMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function Awards() {
  return (
    <section className={L.sec} id="awards" aria-labelledby="awards-title">
      <div className={L.wrap}>
        <Reveal className={L.head}>
          <h2 id="awards-title" className={L.h2}>
            Recognition.
          </h2>
        </Reveal>
        <Reveal as="ul" className={`${L.grid} ${L.eq} ${s.list}`}>
          {AWARDS.map((a) => {
            const shown = a.text.join("\n");
            const full = a.full ?? shown;
            return (
              <li key={a.href} className={s.item}>
                <a
                  className={`${L.card} ${s.card}`}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${a.name}, ${AWARD_EVENT}: announcement by Mantle on X, ${AWARD_DATE}`}
                >
                  <span className={s.award}>
                    <AwardMark size={20} className={s.rosette} />
                    <span className={s.awardName}>{a.name}</span>
                    <span className={s.event}>{AWARD_EVENT}</span>
                  </span>

                  <span className={s.post}>
                    <span className={s.postHead}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/brand/partners/mantle.png" alt="" width={36} height={36} className={s.avatar} />
                      <span className={s.who}>
                        <b>Mantle</b>
                        <span className={s.handle}>@Mantle_Official</span>
                      </span>
                      <XMark />
                    </span>
                    <span className={s.text} title={full}>
                      {shown}
                    </span>
                    <span className={s.date}>{AWARD_DATE}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </Reveal>
        <p className={s.hack}>{HACK_LINE}</p>
      </div>
    </section>
  );
}
