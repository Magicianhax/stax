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
    a: "Real shares — not a bet on a price. A regulated issuer buys the actual stock, holds it with a custodian, and issues you a token that tracks one share. On Base that issuer is Coinbase; on Mantle it's Backed.",
  },
  {
    q: "Who issues the stocks?",
    a: "On Base, Coinbase — the largest US crypto exchange — puts real US stocks on-chain as tokens that track one share each. On Mantle, a regulated European firm called Backed does the same (the “xStocks”). Either way, every token is matched by a share held in custody — provable on-chain, not promised in fine print.",
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
    a: "In a wallet only you control — Stax never holds your funds. Everything settles on Base, a fast, low-cost Ethereum network built by Coinbase (Mantle is supported too), and every move leaves a public receipt you can check yourself.",
  },
  {
    q: "Can I sell or cash out anytime?",
    a: "Anytime. Sell any holding back to dollars on the spot — no lock-ups, no waiting periods, no penalties.",
  },
  {
    q: "What can I invest in?",
    a: "Names you already know — Apple, Nvidia, Google, Meta, even SpaceX — plus Bitcoin and Ether, and “Safe Dollars” that earn a steady rate for the cash side of a plan. Switch to Mantle for broad funds like the S&P 500. More is on the way.",
  },
];
