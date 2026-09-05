// Eligibility answer shown at the end of the FAQ on both the landing and the in-app
// Help screen. Lives here (components) rather than in lib/faq because the FAQ
// source is owned by the lib layer; fold it into `lib/faq.ts` when that file is
// next touched so the FAQ has one source again.
import type { FaqItem } from "@/lib/faq";

export const ELIGIBILITY_FAQ: FaqItem = {
  q: "Who can use Stax?",
  a: "Tokenized stocks are offered by Coinbase on Base and by Backed on Mantle to eligible people outside the United States. If you're in the US or another restricted region, you can still try the demo, but you won't be able to buy stocks. Everything else in Stax stays in plain words either way.",
};
