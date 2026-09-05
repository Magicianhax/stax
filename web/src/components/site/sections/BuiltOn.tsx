"use client";

// Built on: one line of real partner marks above the footer. Every mark is
// the official artwork (see public/brand/partners/), rendered monochrome
// through a CSS mask so a PNG, a coloured SVG and a gradient wordmark all read
// as one family; height 24px, width from the artwork's own aspect ratio.
// Desktop: one centred row that never wraps. Narrow: the same row inside the
// Marquee. Not links.
import { Marquee } from "@/components/site/ui/Marquee";
import { useMediaQuery } from "@/components/site/ui/useMediaQuery";
import L from "@/components/site/layout.module.css";
import s from "./BuiltOn.module.css";

/** name, mask source, artwork aspect ratio (width / height). */
const PARTNERS: { name: string; src: string; ratio: number }[] = [
  { name: "Base", src: "/brand/partners/base-mono.svg", ratio: 82.6 / 82 },
  { name: "Coinbase", src: "/brand/partners/coinbase.svg", ratio: 24 / 4.8 },
  { name: "Mantle", src: "/brand/partners/mantle-mono.png", ratio: 1 },
  { name: "Backed", src: "/brand/partners/backed.svg", ratio: 576 / 128 },
  { name: "Privy", src: "/brand/partners/privy.png", ratio: 776 / 175 },
  { name: "Pimlico", src: "/brand/partners/pimlico.svg", ratio: 170 / 26 },
  { name: "Chainlink", src: "/brand/partners/chainlink.svg", ratio: 1 },
  { name: "Uniswap", src: "/brand/partners/uniswap.svg", ratio: 400 / 434 },
  { name: "Aave", src: "/brand/partners/aave.svg", ratio: 266 / 139 },
];

function Row({ scrolling }: { scrolling: boolean }) {
  return (
    <ul className={scrolling ? `${s.row} ${s.rowScroll}` : s.row}>
      {PARTNERS.map((p) => {
        const url = `url("${p.src}")`;
        return (
          <li key={p.name} className={s.item}>
            <span
              role="img"
              aria-label={p.name}
              className={s.mark}
              style={{ aspectRatio: String(p.ratio), maskImage: url, WebkitMaskImage: url }}
            />
          </li>
        );
      })}
    </ul>
  );
}

export function BuiltOn() {
  const narrow = useMediaQuery("(max-width: 1099px)");
  return (
    <section id="built-on" className={s.sec} aria-label="Built on">
      <div className={L.wrap}>
        <p className={s.kicker}>Built on</p>
        {narrow ? (
          <Marquee speed={32}>
            <Row scrolling />
          </Marquee>
        ) : (
          <Row scrolling={false} />
        )}
      </div>
    </section>
  );
}
