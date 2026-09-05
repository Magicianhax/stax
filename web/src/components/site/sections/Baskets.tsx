"use client";

// Baskets — "One tap, a whole mix." The curated Base baskets, filtered the same
// way the app filters them (every holding routable today), with their real
// weights. Cards on 3×4 columns at equal height; the whole card is the link.
// One gesture: the weight bars extend from zero the first time the row shows
// (a clip-path on each bar, ScrollTrigger once; drawn by default without JS
// or under reduced motion).
import { useRef } from "react";
import Link from "next/link";
import { getChain } from "@/lib/chains";
import { curatedBaskets, encodeBasketLink, riskWord, type Basket } from "@/lib/baskets";
import { displayFor } from "@/lib/displayAssets";
import { WeightBar } from "@/components/WeightBar";
import { BasketIconGlyph } from "@/components/BasketIcon";
import { gsap, useGSAP, MOTION_OK } from "../ui/gsap";
import { onEnter } from "../ui/Reveal";
import { Reveal } from "../ui/Reveal";
import l from "../layout.module.css";
import s from "./Baskets.module.css";

const BASE = getChain("base");
const BASKETS = curatedBaskets(BASE);

function holdingsLine(b: Basket): string {
  return b.items.map((i) => displayFor(i.symbol).name).join(" · ");
}

export function Baskets() {
  const scope = useRef<HTMLElement>(null);

  // Weight bars extend from zero the first time the grid enters the viewport.
  // Uses the shared `onEnter` trigger (IntersectionObserver + safety) rather than
  // ScrollTrigger, so a stale trigger position can never leave the bars clipped.
  useGSAP(
    (_ctx, contextSafe) => {
      const grid = scope.current?.querySelector(`.${s.grid}`);
      if (!grid) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.set(`.${s.bar}`, { clipPath: "inset(0 100% 0 0 round 99px)" });
        const play = contextSafe!(() => {
          gsap.to(`.${s.bar}`, { clipPath: "inset(0 0% 0 0 round 99px)", duration: 1.1, ease: "expo.out", stagger: 0.07, clearProps: "clipPath" });
        });
        const dispose = onEnter(grid, play, 0.85);
        return () => dispose();
      });
    },
    { scope },
  );

  return (
    <section className={l.sec} id="baskets" aria-labelledby="baskets-title" ref={scope}>
      <div className={l.wrap}>
        <div className={l.head}>
          <h2 id="baskets-title" className={l.h2}>
            One tap, a whole mix.
          </h2>
        </div>

        <Reveal as="ul" className={`${l.grid} ${l.eq} ${s.grid}`} stagger={0.06}>
          {BASKETS.map((b) => (
            <li key={b.id} className={s.cell}>
              <Link
                href={`/app?basket=${encodeBasketLink(b)}`}
                className={`${l.card} ${s.card}`}
                aria-label={`${b.name}, ${riskWord(b.riskScore)}: ${holdingsLine(b)}. Open in Stax.`}
              >
                <div className={s.top}>
                  <span
                    className={s.disc}
                    aria-hidden
                    style={{
                      background: `color-mix(in srgb, ${b.color} 16%, var(--s-surface))`,
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${b.color} 24%, transparent)`,
                    }}
                  >
                    <BasketIconGlyph icon={b.icon} size={22} color={b.color} />
                  </span>
                  <div className={s.text}>
                    <div className={s.name}>{b.name}</div>
                    <div className={s.risk}>{riskWord(b.riskScore)}</div>
                  </div>
                </div>
                <div className={s.holdings}>{holdingsLine(b)}</div>
                <div className={s.bar}>
                  <WeightBar items={b.items} height={8} />
                </div>
              </Link>
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
