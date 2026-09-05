"use client";

// Sticky glass nav: mark, three anchors, "Open Stax". The hairline under the
// bar runs edge to edge of the container, not the viewport, so it lines up
// with every section divider below. Under 720px the anchors collapse (every
// section is one scroll away on a phone) and only mark + CTA remain.
import { ArrowRight } from "lucide-react";
import { ShineButton } from "@/components/site/ui/ShineButton";
import L from "./layout.module.css";
import s from "./Nav.module.css";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#baskets", label: "Baskets" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  return (
    <nav className={s.nav} aria-label="Site">
      <div className={L.wrap}>
        <div className={s.bar}>
          <a className={s.brand} href="#top" aria-label="Stax, back to top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stax-light.png" alt="" width={28} height={28} className={s.mark} />
            <span>Stax</span>
          </a>
          <div className={s.links}>
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className={s.link}>
                {l.label}
              </a>
            ))}
          </div>
          <ShineButton href="/app" className={s.cta}>
            Open Stax
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </ShineButton>
        </div>
      </div>
    </nav>
  );
}
