"use client";

// What you can own — the heading, one line with the real count (42 stocks and
// funds from bStock and Ondo, plus Bitcoin, Ethereum and BNB, all from the BNB
// Chain registry through the app's own buyable filter), then one quiet marquee
// line of their logos. 56px logos, no captions; each carries its name for
// screen readers. Leveraged funds are left out of the row (the app files them
// under "Riskier picks" and Vera skips them unless asked). Logos come from
// displayFor/TokenLogo, the same source the app uses, never a URL typed here;
// a ticker without a logo yet shows the app's own coloured monogram. Pauses on
// hover and stops under reduced motion (the row stays scrollable by hand).
// One line under it for Savings and the other networks.
import type { Asset } from "@/lib/chains";
import { displayFor } from "@/lib/displayAssets";
import { OTHER_NETWORKS_LINE, assetsLine, landingAssetRow } from "@/lib/site/landing";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { Marquee } from "../ui/Marquee";
import l from "../layout.module.css";
import s from "./Assets.module.css";

const BUYABLE: Asset[] = landingAssetRow();

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
          <p className={l.lead}>{assetsLine()}</p>
        </div>
      </div>

      <div className={s.row} aria-label="Buyable on BNB Chain today" role="group">
        <Marquee speed={36} className={s.marquee}>
          {LINE.map((a, i) => (
            <Logo key={`${a.symbol}-${i}`} a={a} hidden={i >= BUYABLE.length} />
          ))}
        </Marquee>
      </div>

      <div className={l.wrap}>
        <div className={l.grid}>
          <p className={s.more}>{OTHER_NETWORKS_LINE}</p>
        </div>
      </div>
    </section>
  );
}
