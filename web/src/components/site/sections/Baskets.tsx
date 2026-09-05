"use client";

// Baskets — "One tap, a whole mix." The curated Base baskets, filtered the same
// way the app filters them (every holding routable today), with their real
// weights. Name, risk word, holdings, weight bar. Each card deep-links into the
// app with the basket encoded.
import Link from "next/link";
import { getChain } from "@/lib/chains";
import {
  curatedBaskets,
  encodeBasketLink,
  riskWord,
  type Basket,
} from "@/lib/baskets";
import { displayFor } from "@/lib/displayAssets";
import { WeightBar } from "@/components/lite/screens/basketPrimitives";
import { Reveal } from "../motion";
import story from "./story.module.css";
import s from "./Baskets.module.css";

const BASE = getChain("base");
const BASKETS = curatedBaskets(BASE);

function holdingsLine(b: Basket): string {
  return b.items.map((i) => displayFor(i.symbol).name).join(" · ");
}

export function Baskets() {
  return (
    <section className={story.sec} id="baskets" aria-labelledby="baskets-title">
      <div className={story.wrap}>
        <Reveal className={story.head}>
          <h2 id="baskets-title" className={story.h2}>
            One tap, a whole mix.
          </h2>
        </Reveal>

        {/* one reveal for the grid; cells stagger in CSS (see HowItWorks for why) */}
        <Reveal>
          <ul className={s.grid} aria-label="Ready-made baskets">
            {BASKETS.map((b) => (
              <li key={b.id} className={s.cell}>
                <Link
                  href={`/app?basket=${encodeBasketLink(b)}`}
                  className={s.card}
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
                      {b.emoji}
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
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
