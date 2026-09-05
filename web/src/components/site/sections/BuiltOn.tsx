// Built on — one quiet line of marks above the footer. No roles, no copy:
// the network marks are the official ones from the chain registry, the rest
// are simple drawn monochrome marks tinted with --s-ink-2. Not links.
import { getChain } from "@/lib/chains";
import s from "./BuiltOn.module.css";

type Mark = { kind: "logo"; src: string } | { kind: "mono"; src: string };

const BASE = getChain("base");
const MANTLE = getChain("mantle");

const PARTNERS: { name: string; mark: Mark }[] = [
  { name: BASE.name, mark: { kind: "logo", src: BASE.brand.logo } },
  {
    name: "Coinbase",
    mark: { kind: "mono", src: "/brand/partners/coinbase.svg" },
  },
  { name: MANTLE.name, mark: { kind: "logo", src: MANTLE.brand.logo } },
  { name: "Privy", mark: { kind: "mono", src: "/brand/partners/privy.svg" } },
  {
    name: "Pimlico",
    mark: { kind: "mono", src: "/brand/partners/pimlico.svg" },
  },
  {
    name: "Chainlink",
    mark: { kind: "mono", src: "/brand/partners/chainlink.svg" },
  },
  {
    name: "Uniswap",
    mark: { kind: "mono", src: "/brand/partners/uniswap.svg" },
  },
  { name: "Aave", mark: { kind: "mono", src: "/brand/partners/aave.svg" } },
];

/** A partner mark. Mono marks are tinted through a CSS mask so they follow the ink ramp. */
function MarkGlyph({ mark }: { mark: Mark }) {
  if (mark.kind === "logo") {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={mark.src}
        alt=""
        className={s.mark}
        decoding="async"
        loading="lazy"
      />
    );
  }
  const url = `url("${mark.src}")`;
  return (
    <span
      aria-hidden="true"
      className={`${s.mark} ${s.mono}`}
      style={{ maskImage: url, WebkitMaskImage: url }}
    />
  );
}

export function BuiltOn() {
  return (
    <section id="built-on" className={s.sec} aria-label="Built on">
      <div className={s.wrap}>
        <span className={s.kicker}>Built on</span>
        <ul className={s.row}>
          {PARTNERS.map((p) => (
            <li key={p.name} className={s.item}>
              <MarkGlyph mark={p.mark} />
              <span className={s.name}>{p.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
