// The marketing landing's facts and words for Stax on BNB Chain, kept as plain data and pure
// functions so they can be tested in the node vitest env (site components can't be imported
// there). Every number the page prints comes from the registry the app itself reads
// (lib/chains, lib/baskets, lib/rwa, lib/marketHours), never typed twice, so a claim on `/`
// can't drift from what the app actually does.
//
// Site-only: nothing in the app imports this file.
import { BSC, BASE, MANTLE, assetBySymbol, investableAssets, type Asset, type StaxChain } from "@/lib/chains";
import { curatedBaskets, type Basket } from "@/lib/baskets";
import { displayFor } from "@/lib/displayAssets";
import { BSC_MIN_LEG_USD } from "@/lib/rwa";
import { formatClosesLocal, formatOpensLocal, nextUsCloseMs, usMarketClock } from "@/lib/marketHours";

/** The network the landing leads with: the app's default. */
export const LANDING_CHAIN: StaxChain = BSC;

/** The smallest amount per stock on BNB Chain (Binance won't take less). */
export const MIN_PER_STOCK_USD = BSC_MIN_LEG_USD;

// ── what you can own ─────────────────────────────────────────────────────────

/** Every stock and fund buyable on BNB Chain, through the same filter the app uses. */
export function bscStocks(): Asset[] {
  return investableAssets(BSC).filter((a) => a.tier === "stock");
}

/** Crypto buyable on BNB Chain (BTC, ETH, BNB). */
export function bscCrypto(): Asset[] {
  return investableAssets(BSC).filter((a) => a.tier === "crypto");
}

/**
 * The logo row: the buyable stocks minus leveraged funds (the app lists those under "Riskier
 * picks" and Vera leaves them out unless asked, so the landing doesn't lead with them), then
 * crypto. Order is the registry's own.
 */
export function landingAssetRow(): Asset[] {
  return [...bscStocks().filter((a) => a.risk !== "leveraged"), ...bscCrypto()];
}

/** A display name for a BNB Chain ticker, using the registry's name when the design has none. */
export function bscName(symbol: string): string {
  return displayFor(symbol, assetBySymbol(BSC, symbol)?.name).name;
}

/** "Bitcoin, Ethereum and BNB" from the registry. */
export function cryptoNames(): string {
  return andList(bscCrypto().map((a) => bscName(a.symbol)));
}

export function andList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The one line under the logo row. */
export function assetsLine(): string {
  return `${bscStocks().length} stocks and funds from bStock and Ondo, paid in USDT, plus ${cryptoNames()}.`;
}

/** The quieter second line: where the other networks went. */
export const OTHER_NETWORKS_LINE = `Spare USDT can earn in Venus, a BNB Chain lending app. ${BASE.name} and ${MANTLE.name} are still in Settings; gifts stay on ${BASE.name}.`;

// ── baskets ──────────────────────────────────────────────────────────────────

/**
 * The six themed baskets the landing shows, in this order: AI chips, Magnificent 7, index
 * funds, Buffett-style, pre-IPO, stocks + Bitcoin. Six fills the 3-up grid in two rows. Each
 * one still has to pass the app's own `curatedBaskets` filter (every holding buyable), so a
 * basket the app would hide never shows here either.
 */
export const LANDING_BASKET_SLUGS = [
  "chip-makers",
  "magnificent-7",
  "broad-market",
  "buffett-style-value",
  "pre-ipo",
  "stocks-and-bitcoin",
] as const;

export function landingBaskets(): Basket[] {
  const live = curatedBaskets(BSC);
  return LANDING_BASKET_SLUGS.map((slug) => live.find((b) => b.id === `${BSC.key}:${slug}`)).filter(
    (b): b is Basket => Boolean(b),
  );
}

/** "Nvidia · Broadcom · …" for a basket card. */
export function basketHoldingsLine(b: Pick<Basket, "items">): string {
  return b.items.map((i) => bscName(i.symbol)).join(" · ");
}

// ── the market, right now ────────────────────────────────────────────────────

export interface MarketNow {
  open: boolean;
  text: string;
}

/**
 * The hero's live line, in the visitor's own time: "The US market is open · closes 4:00 PM
 * your time" or "The US market is closed · opens Mon 9:30 AM your time". Same clock and the
 * same local-time formatter the app's Market header uses (`usMarketClock`, `formatOpensLocal`).
 */
export function marketNow(nowMs: number): MarketNow {
  const clock = usMarketClock(nowMs);
  if (clock.buyable) {
    const close = nextUsCloseMs(nowMs);
    return { open: true, text: close ? `The US market is open · ${formatClosesLocal(close, nowMs)}` : "The US market is open" };
  }
  const openMs = clock.nextOpenMs;
  return { open: false, text: openMs ? `The US market is closed · ${formatOpensLocal(openMs, nowMs)}` : "The US market is closed" };
}

// ── copy ─────────────────────────────────────────────────────────────────────

export const HERO = {
  title: "The broker that knows the market is closed.",
  /** The title's last word, set in italic; always the tail of `title`. */
  titleEm: "closed.",
  sub: "Tell Vera a goal. She buys real stocks on BNB Chain, never at a weekend premium.",
} as const;

/** How it works: four moves, one short line each. `checked` steps wear the trust colour. */
export const MOVES: { key: "goal" | "plan" | "check" | "own"; title: string; note: string; checked?: boolean }[] = [
  { key: "goal", title: "Say the goal", note: "In plain words, like “$100, mostly AI chips, a little Bitcoin.”" },
  { key: "plan", title: "A plan from what’s open", note: "Only stocks you can buy right now, from whichever company costs less." },
  { key: "check", title: "Checked with Binance", note: "Binance tests the trade first. One it says would fail is never sent.", checked: true },
  { key: "own", title: "You own it", note: "In your own account on BNB Chain. No Stax fee, no network fees.", checked: true },
];

/** What Stax refuses on BNB Chain: each one a rule the app enforces, not a promise. */
export const REFUSALS: { title: string; note: string }[] = [
  {
    title: "A weekend premium",
    note: "While the US market is shut, a token can cost more than the real share. Vera waits, and tells you when it opens in your own time.",
  },
  {
    title: `Less than $${MIN_PER_STOCK_USD} of a stock`,
    note: `$${MIN_PER_STOCK_USD} is the smallest trade Binance takes. With a small amount, Vera picks fewer stocks.`,
  },
  {
    title: "A trade Binance says would fail",
    note: "Binance tests the trade before you sign. If it wouldn’t go through, nothing is sent.",
  },
  {
    title: "A leveraged fund you didn’t ask for",
    note: "Funds that move 3× the market each day stay out of Vera’s plans unless you ask for one.",
  },
];

/** What the signed-plan contract checks, after "On <networks>". */
export const CONTRACT_CLAUSE = ", a contract also checks Vera’s signature, your risk limit and every cent spent.";

/** The one line about the signed-plan contract, for the networks it is live on. */
export function contractLine(chains: StaxChain[]): string {
  const names = chains.map((c) => c.name);
  if (names.length === 0) return "";
  return `On ${andList(names)}${CONTRACT_CLAUSE}`;
}

export const HOW_TITLE = "Four moves.";
export const REFUSE_TITLE = "What Stax refuses.";

export const HACK_LINE = "Stax on BNB Chain is built for the BNB Hack: Tokenized Stocks Edition.";

export const CLOSING_LINE = "Buy your first real stock, at the right time.";

export const ELIGIBILITY_LINE =
  "Stocks are issued by bStock and Ondo on BNB Chain, Coinbase on Base and Backed on Mantle, not by Stax, for eligible non-US users.";

export const FAQ: { q: string; a: string }[] = [
  {
    q: "What exactly am I buying?",
    a: "A token that follows the price of one real share. On BNB Chain, two companies make these tokens: bStock and Ondo. Stax doesn’t make them; it helps you buy them.",
  },
  {
    q: "Why does a stock show two prices?",
    a: "One is the token, the other is the real share it follows. They’re usually close. Most stocks also come from both bStock and Ondo, so Stax buys the one you can buy now that costs less compared with the real share.",
  },
  {
    q: "What happens when the US market is closed?",
    a: "The real share stops trading, so a token’s price can drift away from it. On weekends and US holidays, Vera waits and tells you when the market opens, in your own time. On weekday evenings, some stocks can still be bought through Ondo.",
  },
  {
    q: "Who is Vera, and do I stay in control?",
    a: "Vera is your AI investing assistant. Tell her a goal and she builds a plan from stocks you can buy right now, with a reason for each. Nothing moves until you tap to confirm.",
  },
  {
    q: "How much do I need to start?",
    a: `$${MIN_PER_STOCK_USD} per stock. It’s the smallest trade Binance takes, so every stock in a plan gets at least $${MIN_PER_STOCK_USD}. With $20, Vera picks up to ${Math.floor(20 / MIN_PER_STOCK_USD)} stocks.`,
  },
  {
    q: "Do I pay any fees?",
    a: "No Stax fee on BNB Chain, and no network fees: Stax pays them. You sign in with email or Google, with no seed phrase to keep safe.",
  },
  {
    q: "Which network does Stax use?",
    a: "BNB Chain, by default, with your cash in USDT, a digital dollar. Base and Mantle are still there in Settings, and gifts stay on Base.",
  },
  {
    q: "Can Vera invest for me on a schedule?",
    a: "Autopilot is rolling out on BNB Chain after a funded test. Its rules invest on a schedule, buy when a stock costs less than the real share, keep a mix balanced, and more. Rules only ever buy.",
  },
  {
    q: "Who can use Stax?",
    a: "Tokenized stocks are for eligible people outside the United States. If you’re in the US or another restricted region, you can still try the demo.",
  },
];

export const SITE_DESCRIPTION_BSC =
  "Real tokenized stocks on BNB Chain, from bStock and Ondo. Vera, an AI broker, plans from what’s open and won’t buy at a weekend premium. Email login, no seed phrase, no Stax fee.";

export const OG_ALT =
  "Stax, the broker that knows the market is closed. Tokenized stocks from bStock and Ondo on BNB Chain, planned by Vera, an AI broker.";

/** Words a first-time investor shouldn't meet on the landing. */
export const JARGON = ["venue", "spread", "rfq", "slippage", "gas", "aggregator", "protocol"] as const;

/** The jargon words `text` contains, as whole words. */
export function jargonIn(text: string): string[] {
  return JARGON.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
}
