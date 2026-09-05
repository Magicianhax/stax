// Close — one line in Fraunces on an ink band, "Open Stax", then the one-line
// "Built on" marks and a compact footer. The band inverts the page (ink
// ground, paper type) so the last thing on the page is also the most decisive;
// in dark mode the tokens flip and it stays readable without a second palette.
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { BuiltOn } from "./BuiltOn";
import s from "./Closing.module.css";

const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "How it works", href: "#how" },
  { label: "Baskets", href: "#baskets" },
  { label: "FAQ", href: "#faq" },
  { label: "Demo", href: "/demo" },
  { label: "@stax_market", href: "https://x.com/stax_market", external: true },
  {
    label: "GitHub",
    href: "https://github.com/Magicianhax/stax",
    external: true,
  },
];

export function Closing() {
  return (
    <>
      <section id="open" className={s.band} aria-labelledby="open-title">
        <div className={s.wrap}>
          <h2 id="open-title" className={s.line}>
            Own a piece of what you already believe in.
          </h2>
          <Link href="/app" className={s.primary}>
            Open Stax
            <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <BuiltOn />

      <footer className={s.footer}>
        <div className={s.wrap}>
          <div className={s.top}>
            <a href="#top" className={s.brand}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/stax-light.png"
                alt=""
                width={26}
                height={26}
                className={s.mark}
              />
              <span>Stax</span>
            </a>
            <nav aria-label="Footer">
              <ul className={s.links}>
                {LINKS.map((l) => (
                  <li key={l.href}>
                    {l.external ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className={s.link}
                      >
                        {l.label}
                        <ArrowUpRight
                          size={14}
                          strokeWidth={2.4}
                          aria-hidden="true"
                        />
                      </a>
                    ) : l.href.startsWith("#") ? (
                      <a href={l.href} className={s.link}>
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className={s.link}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className={s.bottom}>
            <p className={s.elig}>
              Stocks are issued by Coinbase on Base and Backed on Mantle for
              eligible non-US users.
            </p>
            <p className={s.copy}>© 2026 Stax</p>
          </div>
        </div>
      </footer>
    </>
  );
}
