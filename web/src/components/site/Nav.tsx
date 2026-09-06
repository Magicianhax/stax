"use client";

// Sticky glass nav on the container grid: brand left, section links centred
// (the underline follows the section in view), "Try the demo" + "Open Stax"
// right. 72px tall; once the page has scrolled 24px only the glass strengthens (no layout animation),
// strengthening. The hairline runs on the container edges, like every section
// divider. Under 720px the links live behind a 44px menu button that opens a
// full-width glass sheet (Escape closes, focus stays inside, aria-expanded).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { ShineButton } from "@/components/site/ui/ShineButton";
import L from "./layout.module.css";
import s from "./Nav.module.css";

const LINKS = [
  { id: "how", label: "How it works" },
  { id: "baskets", label: "Baskets" },
  { id: "faq", label: "FAQ" },
];

const SCROLLED_AT = 24;

function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > SCROLLED_AT);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  return scrolled;
}

/** The id of the linked section currently in the middle band of the viewport. */
function useActiveSection(): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = LINKS.map((l) => document.getElementById(l.id)).filter((el): el is HTMLElement => !!el);
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // Highest section on the page wins when two overlap the band.
        setActive(LINKS.find((l) => visible.has(l.id))?.id ?? null);
      },
      { rootMargin: "-35% 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

export function Nav() {
  const scrolled = useScrolled();
  const active = useActiveSection();
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Sheet: Escape closes, Tab cycles inside the sheet + menu button, first
  // link takes focus on open, the button gets it back on close.
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const menuButton = menuRef.current;
    const focusables = () => [
      ...(sheet ? Array.from(sheet.querySelectorAll<HTMLElement>("a, button")) : []),
      ...(menuButton ? [menuButton] : []),
    ];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[next].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      menuButton?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <nav className={s.nav} data-scrolled={scrolled || undefined} data-open={open || undefined} aria-label="Site">
      <div className={L.wrap}>
        <div className={s.bar}>
          <a className={s.brand} href="#top" aria-label="Stax, back to top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/stax-light.png" alt="" width={28} height={28} className={s.mark} />
            <span className={s.wordmark}>Stax</span>
          </a>

          <div className={s.links}>
            {LINKS.map((l) => (
              <a key={l.id} href={`#${l.id}`} className={s.link} data-active={active === l.id || undefined} aria-current={active === l.id ? "location" : undefined}>
                {l.label}
              </a>
            ))}
          </div>

          <div className={s.right}>
            <Link href="/demo" className={s.demo}>
              Try the demo
            </Link>
            <ShineButton href="/app" className={s.cta}>
              Open Stax
              <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
            </ShineButton>
            <button
              ref={menuRef}
              type="button"
              className={s.menu}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X size={22} strokeWidth={2.2} aria-hidden="true" /> : <Menu size={22} strokeWidth={2.2} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div id="site-menu" ref={sheetRef} className={s.sheet}>
          <div className={L.wrap}>
            <ul className={s.sheetList}>
              {LINKS.map((l) => (
                <li key={l.id}>
                  <a href={`#${l.id}`} className={s.sheetLink} data-active={active === l.id || undefined} onClick={close}>
                    {l.label}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/demo" className={s.sheetLink} onClick={close}>
                  Try the demo
                </Link>
              </li>
            </ul>
          </div>
        </div>
      )}
    </nav>
  );
}
