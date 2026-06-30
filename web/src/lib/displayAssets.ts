// Display metadata for assets — bridges the real on-chain registry (lib/mantle.ts,
// keyed by ticker symbol) to the design's presentational shape (TileAsset + plain
// words). The *logic* universe stays in lib/mantle.ts; this only adds look & copy
// (tile color, monogram glyph, a category label, a demo sparkline, a friendly
// description) so the re-skinned Lite screens can render faithfully.
//
// Copy + colors are ported from the design handoff (data.jsx). Symbols that have
// no design entry fall back to sensible defaults so nothing ever crashes.
import type { TileAsset } from "@/components/design";

export interface AssetDisplay extends TileAsset {
  /** Plain-language category shown in Lite (e.g. "Big tech", "Funds", "Safer"). */
  cat: string;
  /** One-line, jargon-free description. */
  desc: string;
  /** Demo daily move (%) used only to tint sparklines up/down. */
  day: number;
  /** Demo sparkline series (presentational only). */
  spark: number[];
  /** Market ticker shown in Pro (e.g. "AAPL"). */
  ticker?: string;
  /** Indicative price per share (USD) — presentational reference only. */
  price?: number;
  /** Indicative yield for "Safer" assets (e.g. "4.8%"). */
  apy?: string;
  /** True for tiers not yet permissionlessly buyable through the executor. */
  coming?: boolean;
}

// Real brand logos served by Backed's xStocks metadata CDN. Keyed by our symbol,
// valued by the xStock ticker file (e.g. AAPL → AAPLx.png).
const LOGO_BASE = "https://xstocks-metadata.backed.fi/logos/tokens";
function logoUrl(xStock: string): string {
  return `${LOGO_BASE}/${xStock}.png`;
}

// Recognisable token logos for the non-xStock assets (crypto + the safe dollar),
// served from jsDelivr's cryptocurrency-icons set. AssetTile falls back to the
// coloured monogram if any of these ever fail to load.
const CRYPTO_ICON = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";

// Keyed by the ticker `symbol` used in lib/mantle.ts.
// Prices/apy are indicative reference figures (ported from the design handoff,
// data.jsx) used for the Pro market/asset views; the real on-chain value comes
// from usePortfolio/useQuote. Sparklines + day moves are presentational tints.
const DISPLAY: Record<string, AssetDisplay> = {
  // Cash — the spendable dollar (USDC). Real Circle logo, self-hosted.
  USDC: { name: "US Dollar", ticker: "USDC", logo: "/icons/usdc.svg", color: "#2775CA", kind: "safe", cat: "Cash", desc: "USDC is a digital dollar that always aims to be worth $1. It's your spendable cash on Stax: add it, invest it, or send it.", price: 1, apy: undefined, day: 0, spark: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8] },
  AAPL: { name: "Apple", ticker: "AAPL", logo: logoUrl("AAPLx"), color: "#3b3f44", kind: "stock", cat: "Big tech", desc: "Apple makes the iPhone, Mac, and iPad, and earns a steady, growing income from services like the App Store and iCloud. It's one of the most valuable companies in the world.", price: 228.42, day: 0.82, spark: [4, 5, 4, 6, 7, 6, 8, 9, 8, 10] },
  NVDA: { name: "Nvidia", ticker: "NVDA", logo: logoUrl("NVDAx"), color: "#4a7d2c", glyph: "N", kind: "stock", cat: "Big tech", desc: "Nvidia designs the chips that train and run most of today's AI. The same hardware also powers gaming and data centers, which has made it a key player in the AI boom.", price: 134.19, day: 2.41, spark: [3, 4, 5, 5, 7, 8, 7, 9, 11, 12] },
  TSLA: { name: "Tesla", ticker: "TSLA", logo: logoUrl("TSLAx"), color: "#b03a2e", kind: "stock", cat: "Big tech", desc: "Tesla builds electric cars and home battery systems, and is investing heavily in self-driving software and robotics. Its share price tends to move sharply in both directions.", price: 342.11, day: -1.36, spark: [9, 8, 9, 7, 8, 6, 7, 6, 5, 6] },
  GOOGL: { name: "Google", ticker: "GOOGL", logo: logoUrl("GOOGLx"), color: "#356ac3", glyph: "G", kind: "stock", cat: "Big tech", desc: "Google (Alphabet) runs the world's largest search and online-ad business, plus Android, YouTube, and a fast-growing cloud and AI arm.", price: 178.55, day: 0.51, spark: [5, 6, 6, 7, 7, 8, 8, 9, 9, 10] },
  META: { name: "Meta", ticker: "META", logo: logoUrl("METAx"), color: "#2a6ad4", glyph: "M", kind: "stock", cat: "Big tech", desc: "Meta owns Instagram, WhatsApp, and Facebook, reaching billions of people daily. Most of its money comes from ads, and it's spending heavily on AI.", price: 612.04, day: 1.12, spark: [6, 7, 7, 8, 9, 9, 10, 10, 11, 12] },
  SPY: { name: "S&P 500", ticker: "SPY", logo: logoUrl("SPYx"), color: "#1f6f54", kind: "fund", cat: "Funds", desc: "One fund that holds the 500 largest US companies at once, so your money is spread across the whole American market instead of a single stock. A common starting point for new investors.", price: 583.27, day: 0.34, spark: [6, 6, 7, 7, 7, 8, 8, 8, 9, 9] },
  QQQ: { name: "Nasdaq-100", ticker: "QQQ", logo: logoUrl("QQQx"), color: "#1c8a6e", kind: "fund", cat: "Funds", desc: "A fund that holds the 100 largest non-financial companies on the Nasdaq, weighted toward big technology names like Apple, Nvidia, and Microsoft.", price: 511.86, day: 0.68, spark: [5, 6, 6, 7, 8, 8, 9, 9, 10, 11] },
  HOOD: { name: "Robinhood", ticker: "HOOD", logo: logoUrl("HOODx"), color: "#3d8a3d", kind: "stock", cat: "More", desc: "Robinhood runs a popular app for buying stocks and crypto. Here you own a piece of the company itself, which earns money as more people trade.", price: 41.92, day: 3.04, spark: [4, 5, 5, 6, 6, 7, 8, 9, 9, 11] },
  CRCL: { name: "Circle", ticker: "CRCL", logo: logoUrl("CRCLx"), color: "#2f6fd0", glyph: "C", kind: "stock", cat: "More", desc: "Circle is the company behind USDC, one of the largest digital dollars used across crypto. It earns income on the reserves that back the coin.", price: 38.5, day: 1.88, spark: [5, 5, 6, 6, 7, 7, 8, 8, 9, 9] },
  MSTR: { name: "Strategy", ticker: "MSTR", logo: logoUrl("MSTRx"), color: "#d08a2a", kind: "stock", cat: "More", desc: "Strategy (formerly MicroStrategy) is a software firm best known for holding one of the largest corporate stashes of Bitcoin, so its price tends to follow Bitcoin closely.", price: 392.77, day: -2.1, spark: [9, 10, 8, 9, 7, 8, 6, 7, 5, 6] },
  // Safer / crypto tiers (kind: "safe" renders a "$" tile). mETH routes through
  // Agni (validated); FBTC has no clean single-router USDC route, so it stays
  // honestly flagged `coming`.
  // sUSDe DISABLED 2026-06-30: its Agni USDe<>sUSDe pool (0x07277…fBfc) drained to
  // ZERO in-range liquidity, so both buy and sell revert (empty 0x) during the
  // gasless UserOp simulation. No other venue is usable (Fluxion/Agni "no route";
  // Merchant Moe routes but ~93% price impact). Flagged `coming` to pull it from
  // the buy/sell UI and the AI universe (see lib/server/allocate.ts BUYABLE).
  // Re-enable once a liquid USDC route exists (add a validated ASSET_ROUTES entry),
  // or mint via Ethena's StakedUSDe vault (deposit USDe) instead of a DEX swap.
  sUSDe: { name: "Safe Dollars", ticker: "sUSDe", logo: "https://assets.coingecko.com/coins/images/33613/small/USDE.png", color: "#c19a52", glyph: "$", kind: "safe", cat: "Safer", desc: "A dollar-based savings asset that grows in value as it earns a steady yield, so its price sits a little above $1 and drifts up over time. It's the calmest option here, though the rate moves and isn't guaranteed.", price: 1.23, apy: "4.8%", day: 0.01, coming: true, spark: [8, 8, 8, 8, 9, 9, 9, 9, 10, 10] },
  // Ondo RWA dollars — both REAL on Mantle but not yet buyable in-app (KYC mint/redeem
  // + no DEX liquidity), so shown as `coming`. USDY is the accumulating token (price
  // drifts up); mUSD is its $1-pegged rebasing wrapper. Prices/apy are indicative.
  USDY: { name: "US Treasuries", ticker: "USDY", logo: "https://assets.coingecko.com/coins/images/31700/standard/usdy_%281%29.png?1696530524", color: "#2e6f5e", glyph: "$", kind: "safe", cat: "Safer", desc: "Ondo's USDY is backed by short-term US Treasuries, the safest corner of the market, and pays a steady yield. It's live on Mantle; we're adding it to Stax once it can be bought without paperwork.", price: 1.06, apy: "~4.5%", day: 0.01, coming: true, spark: [8, 8, 8, 9, 9, 9, 9, 9, 10, 10] },
  mUSD: { name: "Mantle USD", ticker: "mUSD", logo: "https://assets.coingecko.com/coins/images/31700/standard/usdy_%281%29.png?1696530524", color: "#2f7d9c", glyph: "$", kind: "safe", cat: "Safer", desc: "The dollar-stable version of USDY: it stays at about $1 while quietly paying out yield in extra tokens. Same US Treasury backing, live on Mantle, coming to Stax once it's freely tradable.", price: 1.0, apy: "~4.5%", day: 0, coming: true, spark: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8] },
  mETH: { name: "Staked ETH", ticker: "mETH", logo: `${CRYPTO_ICON}/eth.svg`, color: "#5b7fd0", kind: "crypto", cat: "Crypto", desc: "Ethereum that's staked to help secure the network, earning a steady staking reward on top of Ether's own price moves. Crypto, so expect bigger swings.", price: 1830.0, apy: "3.6%", day: 0.9, spark: [5, 6, 6, 7, 6, 7, 8, 8, 9, 9] },
  FBTC: { name: "Bitcoin", ticker: "FBTC", logo: `${CRYPTO_ICON}/btc.svg`, color: "#d08a2a", glyph: "B", kind: "crypto", cat: "Crypto", desc: "A tokenized form of Bitcoin, the original and largest cryptocurrency, giving you Bitcoin's price exposure on Mantle. Known for large ups and downs.", price: 96250.0, day: 1.4, coming: true, spark: [6, 7, 6, 8, 7, 9, 8, 10, 9, 11] },
};

const FALLBACK_COLORS = ["#3b3f44", "#1f6f54", "#356ac3", "#b03a2e", "#4a7d2c"];

function fallback(symbol: string, name?: string): AssetDisplay {
  const color = FALLBACK_COLORS[symbol.charCodeAt(0) % FALLBACK_COLORS.length];
  return {
    name: name || symbol,
    ticker: symbol,
    color,
    glyph: (name || symbol)[0],
    kind: "stock",
    cat: "Stocks",
    desc: "A real company listed on the US stock market. Its price moves with how the business performs and how investors feel about it.",
    day: 0,
    spark: [6, 6, 7, 7, 8, 8, 8, 9, 9, 10],
  };
}

/** Full display record for a ticker symbol (never throws). */
export function displayFor(symbol: string, name?: string): AssetDisplay {
  return DISPLAY[symbol] ?? fallback(symbol, name);
}

/** Just the bits a design <AssetTile>/<HoldingRow> needs. */
export function toTile(symbol: string, name?: string): TileAsset & { day: number; spark: number[] } {
  const d = displayFor(symbol, name);
  return { name: d.name, color: d.color, glyph: d.glyph, kind: d.kind, logo: d.logo, day: d.day, spark: d.spark };
}

/** Friendly category label for a symbol (Lite secondary line). */
export function catFor(symbol: string, name?: string): string {
  return displayFor(symbol, name).cat;
}
