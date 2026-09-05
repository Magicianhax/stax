"use client";

// Sticky glass nav for the marketing site: mark, three anchor links, "Open Stax".
// Under 720px the links collapse and only the mark + "Open Stax" remain (every
// section is one scroll away on a phone, and a burger menu would be a second
// tap for nothing). Every target is at least 44px tall.
import Link from "next/link";
import s from "./Nav.module.css";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#baskets", label: "Baskets" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  return (
    <nav className={s.nav} aria-label="Site">
      <div className={s.inner}>
        <a className={s.brand} href="#top" aria-label="Stax, back to top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/stax-light.png" alt="" width={30} height={30} className={s.mark} />
          <span>Stax</span>
        </a>
        <div className={s.links}>
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={s.link}>
              {l.label}
            </a>
          ))}
        </div>
        <Link href="/app" className={`btn btn-primary btn-sm ${s.cta}`}>
          Open Stax
        </Link>
      </div>
    </nav>
  );
}
