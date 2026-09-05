"use client";

// FAQ — five of the shared questions from lib/faq, each answered in one short
// breath (the full answers stay in lib/faq for the in-app Help screen). On the
// grid: heading 5 columns, list 7 columns. Native <details>/<summary>, so
// keyboard and screen-reader behaviour is the browser's own and `name` makes
// it one-open-at-a-time; the chevron turns on transform only.
import { ChevronDown } from "lucide-react";
import { FAQ } from "@/lib/faq";
import { Reveal } from "../ui/Reveal";
import l from "../layout.module.css";
import s from "./Faq.module.css";

/** Short landing answers, keyed by the question in lib/faq (the source of truth). */
const SHORT: Record<string, string> = {
  "What exactly am I buying?":
    "Real shares, not a bet on a price. A regulated issuer buys the stock, holds it with a custodian, and issues a token that tracks one share. Coinbase on Base, Backed on Mantle.",
  "Who is Vera, and do I stay in control?":
    "Vera is your AI investing assistant. Tell her a goal in a sentence and she builds a diversified plan and explains every pick. Nothing moves until you read it and tap to confirm.",
  "What does it cost?":
    "Stax covers the network fees, so you never pay gas. A flat 25 bps on what you invest, and that is it. No subscription, no hidden spreads.",
  "Can I sell or cash out anytime?":
    "Anytime. Sell any holding back to dollars on the spot. No lock-ups, no waiting periods, no penalties.",
  "Who can use Stax?":
    "Tokenized stocks are offered by Coinbase on Base and Backed on Mantle to eligible people outside the United States. In the US or another restricted region, you can still try the demo.",
};

const ITEMS = FAQ.filter((f) => f.q in SHORT).map((f) => ({ q: f.q, a: SHORT[f.q] }));

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
