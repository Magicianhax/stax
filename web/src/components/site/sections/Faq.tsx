// FAQ — five of the shared questions from lib/faq, each answered in one
// short breath (≤ 40 words; the full answers stay in lib/faq for the in-app
// Help screen). Native <details>/<summary>: keyboard and screen-reader
// behaviour is the browser's own, `name` makes it one-open-at-a-time where
// supported. The chevron turns on transform only.
import { ChevronDown } from "lucide-react";
import { FAQ } from "@/lib/faq";
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

const ITEMS = FAQ.filter((f) => f.q in SHORT).map((f) => ({
  q: f.q,
  a: SHORT[f.q],
}));

export function Faq() {
  return (
    <section id="faq" className={s.sec} aria-labelledby="faq-title">
      <div className={s.wrap}>
        <h2 id="faq-title" className={s.title}>
          Questions people ask.
        </h2>
        <div className={s.list}>
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
        </div>
      </div>
    </section>
  );
}
