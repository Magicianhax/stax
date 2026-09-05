"use client";

// What you can own — one quiet marquee row of the logos that are buyable on
// Base today (same filter as the app: routable, not "coming"). No captions;
// each logo carries its name for screen readers. Pauses on hover and stops
// under reduced motion (the row stays scrollable by hand). One line for Mantle.
import { getChain, investableAssets, type Asset } from "@/lib/chains";
import { displayFor } from "@/lib/displayAssets";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { Reveal } from "../motion";
import story from "./story.module.css";
import s from "./Assets.module.css";

const BASE = getChain("base");
const BUYABLE: Asset[] = investableAssets(BASE);

// Repeat until a single copy is comfortably wider than any viewport; the track
// holds two copies and slides by exactly one copy width.
const REPEAT = BUYABLE.length >= 16 ? 1 : BUYABLE.length >= 8 ? 2 : 3;
const COPY = Array.from({ length: REPEAT }, () => BUYABLE).flat();

function Logo({ a, hidden }: { a: Asset; hidden?: boolean }) {
  const d = displayFor(a.symbol, a.name);
  return (
    <li className={s.logo} title={hidden ? undefined : d.name}>
      <TokenLogo symbol={a.symbol} name={a.name} size={52} />
      {!hidden && <span className={s.srOnly}>{d.name}</span>}
    </li>
  );
}

export function Assets() {
  return (
    <section className={story.sec} id="own" aria-labelledby="own-title">
      <div className={story.wrap}>
        <Reveal className={story.head}>
          <h2 id="own-title" className={story.h2}>
            What you can own.
          </h2>
        </Reveal>
      </div>

      <Reveal className={s.row} delay={60}>
        <div className={s.track}>
          <ul className={s.list} aria-label="Buyable on Base today">
            {COPY.map((a, i) => (
              <Logo key={`${a.symbol}-${i}`} a={a} />
            ))}
          </ul>
          <ul className={s.list} aria-hidden>
            {COPY.map((a, i) => (
              <Logo key={`dup-${a.symbol}-${i}`} a={a} hidden />
            ))}
          </ul>
        </div>
      </Reveal>

      <div className={story.wrap}>
        <p className={`${story.quiet} ${s.mantle}`}>
          Also on Mantle: Apple, Tesla, Nvidia, S&amp;P 500, Nasdaq-100 and
          more.
        </p>
      </div>
    </section>
  );
}
