"use client";

// Close: one line in Fraunces on an ink band with "Open Stax" beside it, then
// the "Built on" row, then the footer on the grid: brand 3 columns, links 6
// (one row, never wraps), legal 3 right-aligned. Under 900px everything
// stacks left-aligned. The band inverts the page (ink ground, paper type) so
// the last thing on the page is also the most decisive.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "../ui/Reveal";
import { ShineButton } from "../ui/ShineButton";
import { BuiltOn } from "./BuiltOn";
import l from "../layout.module.css";
import s from "./Closing.module.css";

const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "How it works", href: "#how" },
  { label: "Baskets", href: "#baskets" },
  { label: "FAQ", href: "#faq" },
  { label: "Demo", href: "/demo" },
  { label: "@stax_market", href: "https://x.com/stax_market", external: true },
  { label: "GitHub", href: "https://github.com/Magicianhax/stax", external: true },
];

export function Closing() {
  return (
    <>
      <section id="open" className={s.band} aria-labelledby="open-title">
        <div className={l.wrap}>
          <Reveal className={`${l.grid} ${s.bandGrid}`} stagger={0.08}>
            <h2 id="open-title" className={s.line}>
              Own a piece of what you already believe in.
            </h2>
            <div className={s.cta}>
              <ShineButton href="/app" variant="primary">
                Open Stax
              </ShineButton>
            </div>
          </Reveal>
        </div>
      </section>

      <BuiltOn />

      <footer className={s.footer}>
        <div className={l.wrap}>
          <div className={`${l.grid} ${s.footGrid}`}>
            <a href="#top" className={s.brand}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/stax-light.png" alt="" width={26} height={26} className={s.mark} />
              <span>Stax</span>
            </a>
            <nav aria-label="Footer" className={s.nav}>
              <ul className={s.links}>
                {LINKS.map((li) => (
                  <li key={li.href}>
                    {li.external ? (
                      <a href={li.href} target="_blank" rel="noopener noreferrer" className={s.link}>
                        {li.label}
                        <ArrowUpRight size={14} strokeWidth={2.4} aria-hidden="true" />
                      </a>
                    ) : li.href.startsWith("#") ? (
                      <a href={li.href} className={s.link}>
                        {li.label}
                      </a>
                    ) : (
                      <Link href={li.href} className={s.link}>
                        {li.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
            <div className={s.legal}>
              <p className={s.elig}>Stocks are issued by Coinbase on Base and Backed on Mantle for eligible non-US users.</p>
              <p className={s.copy}>© 2026 Stax</p>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
