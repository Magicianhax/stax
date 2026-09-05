"use client";

// What you can own — one quiet marquee line of the logos that are buyable on
// Base today (same filter as the app: routable, not "coming"). 56px logos, no
// captions; each carries its name for screen readers. Pauses on hover and
// stops under reduced motion (the row stays scrollable by hand). One line for
// Mantle under it, on the grid.
import { getChain, investableAssets, type Asset } from "@/lib/chains";
import { displayFor } from "@/lib/displayAssets";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { Marquee } from "../ui/Marquee";
import l from "../layout.module.css";
import s from "./Assets.module.css";

const BASE = getChain("base");
const BUYABLE: Asset[] = investableAssets(BASE);

// The Mantle line names the registry's stocks, never a typed list.
const MANTLE_NAMES = getChain("mantle").assets.stocks.map((a) => displayFor(a.symbol, a.name).name);
const MANTLE_LINE = `Also on Mantle: ${MANTLE_NAMES.slice(0, -1).join(", ")} and ${MANTLE_NAMES[MANTLE_NAMES.length - 1]}.`;

// The marquee loops one copy of its children; repeat the set until a single
// copy is wider than any desktop viewport so the loop never shows a gap.
const REPEAT = Math.max(1, Math.ceil(24 / Math.max(1, BUYABLE.length)));
const LINE: Asset[] = Array.from({ length: REPEAT }, () => BUYABLE).flat();

/** Repeated copies are `hidden` from assistive tech so each name is read once. */
function Logo({ a, hidden }: { a: Asset; hidden?: boolean }) {
  const d = displayFor(a.symbol, a.name);
  return (
    <span className={s.logo} title={d.name} aria-hidden={hidden || undefined}>
      <TokenLogo symbol={a.symbol} name={a.name} size={56} />
      {!hidden && <span className={s.srOnly}>{d.name}</span>}
    </span>
  );
}

export function Assets() {
  return (
    <section className={l.sec} id="own" aria-labelledby="own-title">
      <div className={l.wrap}>
        <div className={l.head}>
          <h2 id="own-title" className={l.h2}>
            What you can own.
          </h2>
        </div>
      </div>

      <div className={s.row} aria-label="Buyable on Base today" role="group">
        <Marquee speed={36} className={s.marquee}>
          {LINE.map((a, i) => (
            <Logo key={`${a.symbol}-${i}`} a={a} hidden={i >= BUYABLE.length} />
          ))}
        </Marquee>
      </div>

      <div className={l.wrap}>
        <div className={l.grid}>
          <p className={s.mantle}>{MANTLE_LINE}</p>
        </div>
      </div>
    </section>
  );
}
