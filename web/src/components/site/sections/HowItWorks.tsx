"use client";

// How it works — "Four moves." The BNB Chain flow as one diagram on the
// 12-column grid (three columns per move): say the goal, a plan from what's
// open, checked with Binance, you own it. The connecting line draws itself as
// the section scrolls (ScrollTrigger scrub on stroke-dashoffset; without JS or
// under reduced motion the line is simply drawn). Under 900px the line runs
// down the left and the moves become rows.
//
// This section used to be three phone screenshots from /demo. The demo runs on
// Base (Safe Dollars, a 25 bps fee, a Basescan receipt), so on a page that
// leads with BNB Chain those frames said things that aren't true there. The
// diagram (formerly the guarantee's) carries the flow instead until real BNB
// Chain screens exist; the words come from lib/site/landing.
import { useRef } from "react";
import { BadgeCheck, CalendarClock, MessageSquareText, ShieldCheck, type LucideIcon } from "lucide-react";
import { HOW_TITLE, MOVES, PHONES, PHONES_LINK, PHONES_NOTE } from "@/lib/site/landing";
import { siteUrl } from "@/lib/urls";
import { PhoneChrome } from "../PhoneChrome";
import { TiltCard } from "../ui/TiltCard";
import { gsap, useGSAP, MOTION_OK } from "../ui/gsap";
import { Reveal } from "../ui/Reveal";
import l from "../layout.module.css";
import s from "./HowItWorks.module.css";

const ICONS: Record<(typeof MOVES)[number]["key"], LucideIcon> = {
  goal: MessageSquareText,
  plan: CalendarClock,
  check: ShieldCheck,
  own: BadgeCheck,
};

// Node centres on a 600-unit strip; the SVGs stretch to the grid and
// non-scaling strokes keep the line 2px.
const N = MOVES.length;
const centres = Array.from({ length: N }, (_, i) => ((i + 0.5) / N) * 600);
const ACROSS = centres
  .map((x, i) => {
    if (i === 0) return `M${x} 28`;
    const px = centres[i - 1];
    const dip = i % 2 ? 44 : 12;
    return `C${px + 56} ${dip} ${x - 56} ${dip} ${x} 28`;
  })
  .join(" ");
const DOWN = centres
  .map((y, i) => {
    if (i === 0) return `M24 ${y}`;
    const py = centres[i - 1];
    const sway = i % 2 ? 34 : 14;
    return `C${sway} ${py + 50} ${sway} ${y - 50} 24 ${y}`;
  })
  .join(" ");

export function HowItWorks() {
  const scope = useRef<HTMLDivElement>(null);

  // The line draws with the scroll. Only under motion-ok: the CSS default is
  // "drawn", so reduced motion and no-JS both see the finished route.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          `.${s.ink}`,
          { strokeDashoffset: 1 },
          {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: {
              trigger: scope.current,
              start: "top 82%",
              end: "bottom 55%",
              scrub: 0.5,
            },
          },
        );
      });
    },
    { scope },
  );

  return (
    <section className={l.sec} id="how" aria-labelledby="how-title">
      <div className={l.wrap}>
        <div className={l.head}>
          <h2 id="how-title" className={l.h2}>
            {HOW_TITLE}
          </h2>
        </div>

        <div className={s.diagram} ref={scope}>
          {/* one line, drawn by scroll; the ghost underneath shows the route from the start */}
          <svg className={`${s.line} ${s.across}`} viewBox="0 0 600 56" preserveAspectRatio="none" aria-hidden>
            <path d={ACROSS} className={s.ghost} vectorEffect="non-scaling-stroke" />
            <path d={ACROSS} className={s.ink} pathLength={1} vectorEffect="non-scaling-stroke" />
          </svg>
          <svg className={`${s.line} ${s.down}`} viewBox="0 0 48 600" preserveAspectRatio="none" aria-hidden>
            <path d={DOWN} className={s.ghost} vectorEffect="non-scaling-stroke" />
            <path d={DOWN} className={s.ink} pathLength={1} vectorEffect="non-scaling-stroke" />
          </svg>

          <Reveal as="ol" className={`${l.grid} ${s.steps}`} stagger={0.06}>
            {MOVES.map((m) => {
              const Glyph = ICONS[m.key];
              return (
                <li key={m.key} className={s.step} data-checked={m.checked ? "1" : undefined}>
                  <span className={s.disc} aria-hidden>
                    <Glyph size={22} strokeWidth={1.9} />
                  </span>
                  <div className={s.text}>
                    <h3 className={s.stepTitle}>{m.title}</h3>
                    <p className={s.stepNote}>{m.note}</p>
                  </div>
                </li>
              );
            })}
          </Reveal>
        </div>

        {/* The real app on BNB Chain: three screens from the demo, and the way into it. */}
        <Reveal as="ul" className={`${l.grid} ${s.phones}`} stagger={0.08}>
          {PHONES.map((p) => (
            <li key={p.screen} className={s.phoneItem}>
              <TiltCard className={s.tilt} max={3}>
                <PhoneChrome screen={p.screen} className={s.phone} />
              </TiltCard>
              <h3 className={s.phoneTitle}>{p.title}</h3>
            </li>
          ))}
        </Reveal>
        <p className={s.phonesNote}>
          {PHONES_NOTE}{" "}
          <a className={s.phonesLink} href={siteUrl("/demo")}>
            {PHONES_LINK}
          </a>
        </p>
      </div>
    </section>
  );
}
