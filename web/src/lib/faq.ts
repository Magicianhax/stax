// Shared FAQ content — the single source of truth for both the marketing
// landing (`SiteLanding` accordion) and the in-app Help screen (`HelpScreen`).
// Keep answers plain-spoken and honest: this is the same voice Vera uses.

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: "What exactly am I buying?",
    a: "Real shares — not a bet on a price. A regulated firm called Backed buys the actual stock, holds it with a custodian, and issues you a token worth one share. You can redeem it for the real thing.",
  },
  {
    q: "Who is Backed?",
    a: "A regulated European firm that puts real stocks and funds on-chain (the “xStocks”). Every token is matched one-to-one by a share held in custody — provable on-chain, not promised in fine print.",
  },
  {
    q: "Who is Vera, and do I stay in control?",
    a: "Vera is your AI investing assistant. Tell her a goal in a sentence and she designs a diversified plan and explains every pick. Nothing moves until you read it and tap to confirm — you approve every plan.",
  },
  {
    q: "How much do I need to start?",
    a: "One dollar. No minimum balance, no paperwork, no waiting list — just a goal and a tap.",
  },
  {
    q: "What does it cost?",
    a: "Stax covers the network (“gas”) fees, so you never pay gas. We charge a flat 25 bps on what you invest, and that is it. No subscription, no hidden spreads, far less than a typical broker.",
  },
  {
    q: "Where does my money actually live?",
    a: "In a wallet only you control — Stax never holds your funds. Everything settles on Mantle, a fast, low-cost Ethereum network, and every move leaves a public receipt you can check yourself.",
  },
  {
    q: "Can I sell or cash out anytime?",
    a: "Anytime. Sell any holding back to dollars on the spot — no lock-ups, no waiting periods, no penalties.",
  },
  {
    q: "What can I invest in?",
    a: "Names you already know — Apple, Nvidia, Tesla — broad funds like the S&P 500, and stable “Safe Dollars” for the cash side of a plan. More, including US Treasuries, is on the way.",
  },
];
