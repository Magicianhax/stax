"use client";

// FAQ — the landing's own short questions for Stax on BNB Chain (bStock and
// Ondo, the two prices, a closed US market, the $6 minimum, fees, which
// network, Autopilot live on BNB Chain, who can use it), each answered in one short
// breath from lib/site/landing, where the numbers come from the registry.
// The in-app Help screen keeps its own list in lib/faq. On the grid: heading
// 5 columns, list 7 columns. Native <details>/<summary>, so keyboard and
// screen-reader behaviour is the browser's own and `name` makes it
// one-open-at-a-time; the chevron turns on transform only.
import { ChevronDown } from "lucide-react";
import { FAQ as ITEMS } from "@/lib/site/landing";
import { Reveal } from "../ui/Reveal";
import l from "../layout.module.css";
import s from "./Faq.module.css";

export function Faq() {
  return (
    <section id="faq" className={`${l.sec} ${s.sec}`} aria-labelledby="faq-title">
      <div className={l.wrap}>
        <div className={l.grid}>
          <div className={`${l.head} ${s.head}`}>
            <h2 id="faq-title" className={l.h2}>
              Questions people ask.
            </h2>
          </div>
          <Reveal className={s.list} stagger={0.05}>
            {ITEMS.map((item) => (
              <details key={item.q} className={s.item} name="faq">
                <summary className={s.summary}>
                  <span className={s.q}>{item.q}</span>
                  <span className={s.chev} aria-hidden="true">
                    <ChevronDown size={18} strokeWidth={2.4} />
                  </span>
                </summary>
                <p className={s.a}>{item.a}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
