// Shared frame for the legal pages (/privacy, /terms). A server component: the
// site nav on top, one centred 680px prose column with a dated header and
// numbered-free section headings, and a footer row of links. Pages pass their
// sections as data so the copy stays in one place per page.
import type { ReactNode } from "react";
import Link from "next/link";
import { Nav } from "@/components/site/Nav";
import { SiteFrame } from "@/components/site/SiteFrame";
import L from "./layout.module.css";
import s from "./LegalPage.module.css";
import { siteUrl } from "@/lib/urls";

export const LEGAL_UPDATED = "September 7, 2026";

/** Company contact, one place. */
export const CONTACT_EMAIL = "hello@stax.best";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** The governing-law placeholder the owner fills in; styled so it can't be missed. */
export function Fill({ children }: { children: ReactNode }) {
  return <mark className={s.fill}>{children}</mark>;
}

const FOOT_LINKS = [
  { label: "Home", href: siteUrl("/") },
  { label: "Demo", href: siteUrl("/demo") },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export function LegalPage({
  title,
  intro,
  sections,
  current,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  current: "/privacy" | "/terms";
}) {
  return (
    <SiteFrame>
      <Nav />
      <main className={s.main}>
        <div className={L.wrap}>
          <article className={s.article}>
            <header className={s.head}>
              <h1 className={s.title}>{title}</h1>
              <p className={s.updated}>Last updated: {LEGAL_UPDATED}</p>
            </header>
            <p className={s.intro}>{intro}</p>
            {sections.map((sec) => (
              <section key={sec.id} id={sec.id} className={s.section} aria-labelledby={`${sec.id}-title`}>
                <h2 id={`${sec.id}-title`} className={s.h2}>
                  {sec.title}
                </h2>
                <div className={s.body}>{sec.body}</div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <footer className={s.footer}>
        <div className={L.wrap}>
          <nav aria-label="Footer" className={s.footRow}>
            {FOOT_LINKS.map((li) => (
              <Link key={li.href} href={li.href} className={s.footLink} aria-current={li.href === current ? "page" : undefined}>
                {li.label}
              </Link>
            ))}
            <p className={s.copy}>© 2026 Stax</p>
          </nav>
        </div>
      </footer>
    </SiteFrame>
  );
}
