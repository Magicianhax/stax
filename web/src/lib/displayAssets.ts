// Display metadata for assets — bridges the real on-chain registries (lib/chains/*,
// keyed by the shared ticker `symbol`) to the design's presentational shape
// (TileAsset + plain words). The *logic* universe stays in lib/chains; this only
// adds look & copy (tile color, monogram glyph, a category label, a demo
// sparkline, a friendly description) so the re-skinned Lite screens can render
// faithfully on Base and Mantle alike.
//
// Copy + colors are ported from the design handoff (data.jsx). Symbols that have
// no design entry fall back to sensible defaults (built from the registry's
// `Asset.name`) so nothing ever crashes when a chain lists a new ticker.
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

// Real company logos served by Backed's xStocks metadata CDN, keyed by the
// xStock ticker file (e.g. AAPL → AAPLx.png). The same logo serves the Coinbase
// B20 token on Base — it's the company's mark, not the issuer's. Verified live
// for every symbol below on 2026-09-05 (AssetTile falls back to the coloured
// monogram if a logo ever fails to load).
const LOGO_BASE = "https://xstocks-metadata.backed.fi/logos/tokens";
function logoUrl(xStock: string): string {
  return `${LOGO_BASE}/${xStock}.png`;
}

// Recognisable token logos for the crypto tier, served from jsDelivr's
// cryptocurrency-icons set.
const CRYPTO_ICON = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";

// Keyed by the ticker `symbol` shared across lib/chains/base.ts + mantle.ts.
// Prices/apy are indicative reference figures (ported from the design handoff,
// data.jsx) used for the Pro market/asset views; the real on-chain value comes
// from usePortfolio/useQuote. Sparklines + day moves are presentational tints.
const DISPLAY: Record<string, AssetDisplay> = {
  // Cash — the spendable dollar (USDC). Real Circle logo, self-hosted.
  USDC: { name: "US Dollar", ticker: "USDC", logo: "/icons/usdc.svg", color: "#2775CA", kind: "safe", cat: "Cash", desc: "USDC is a digital dollar that always aims to be worth $1. It's your spendable cash on Stax: add it, invest it, or send it.", price: 1, apy: undefined, day: 0, spark: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8] },
  // BSC's cash is Tether's USDT (18 decimals on BNB Chain), not USDC.
  USDT: { name: "US Dollar", ticker: "USDT", logo: "/icons/usdt.svg", color: "#26A17B", kind: "safe", cat: "Cash", desc: "USDT is a digital dollar that always aims to be worth $1. On BNB Chain it's your spendable cash on Stax: add it, invest it, or send it.", price: 1, apy: undefined, day: 0, spark: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8] },

  // --- Big tech (Base: Coinbase tokenized stocks · Mantle: Backed xStocks) ---
  AAPL: { name: "Apple", ticker: "AAPL", logo: logoUrl("AAPLx"), color: "#8b939c", kind: "stock", cat: "Big tech", desc: "Apple makes the iPhone, Mac, and iPad, and earns a steady, growing income from services like the App Store and iCloud. It's one of the most valuable companies in the world.", price: 228.42, day: 0.82, spark: [4, 5, 4, 6, 7, 6, 8, 9, 8, 10] },
  NVDA: { name: "Nvidia", ticker: "NVDA", logo: logoUrl("NVDAx"), color: "#4a7d2c", glyph: "N", kind: "stock", cat: "Big tech", desc: "Nvidia designs the chips that train and run most of today's AI. The same hardware also powers gaming and data centers, which has made it a key player in the AI boom.", price: 134.19, day: 2.41, spark: [3, 4, 5, 5, 7, 8, 7, 9, 11, 12] },
  TSLA: { name: "Tesla", ticker: "TSLA", logo: logoUrl("TSLAx"), color: "#b03a2e", kind: "stock", cat: "Big tech", desc: "Tesla builds electric cars and home battery systems, and is investing heavily in self-driving software and robotics. Its share price tends to move sharply in both directions.", price: 342.11, day: -1.36, spark: [9, 8, 9, 7, 8, 6, 7, 6, 5, 6] },
  GOOGL: { name: "Google", ticker: "GOOGL", logo: logoUrl("GOOGLx"), color: "#356ac3", glyph: "G", kind: "stock", cat: "Big tech", desc: "Google (Alphabet) runs the world's largest search and online-ad business, plus Android, YouTube, and a fast-growing cloud and AI arm.", price: 178.55, day: 0.51, spark: [5, 6, 6, 7, 7, 8, 8, 9, 9, 10] },
  META: { name: "Meta", ticker: "META", logo: logoUrl("METAx"), color: "#2a6ad4", glyph: "M", kind: "stock", cat: "Big tech", desc: "Meta owns Instagram, WhatsApp, and Facebook, reaching billions of people daily. Most of its money comes from ads, and it's spending heavily on AI.", price: 612.04, day: 1.12, spark: [6, 7, 7, 8, 9, 9, 10, 10, 11, 12] },
  AMZN: { name: "Amazon", ticker: "AMZN", logo: logoUrl("AMZNx"), color: "#d9822b", glyph: "A", kind: "stock", cat: "Big tech", desc: "Amazon runs the world's biggest online store and, through AWS, the cloud computing that powers much of the internet. Retail brings the scale; the cloud brings most of the profit.", price: 186.4, day: 0.74, spark: [5, 5, 6, 6, 7, 8, 8, 9, 9, 10] },
  MSFT: { name: "Microsoft", ticker: "MSFT", logo: logoUrl("MSFTx"), color: "#2b7cd3", glyph: "M", kind: "stock", cat: "Big tech", desc: "Microsoft makes Windows and Office, runs the Azure cloud, and is a leading backer of AI tools like Copilot. A steady earner that businesses around the world pay every month.", price: 415.2, day: 0.42, spark: [6, 6, 7, 7, 8, 8, 8, 9, 9, 10] },
  SPCX: { name: "SpaceX", ticker: "SPCX", logo: logoUrl("SPCXx"), color: "#6d7b95", glyph: "S", kind: "stock", cat: "Big tech", desc: "SpaceX builds and launches rockets, and runs Starlink, a satellite internet service used around the world. A rare chance to own a piece of a private space company; expect bigger swings than a household name.", price: 212.0, day: 1.65, spark: [4, 5, 5, 6, 7, 7, 8, 9, 10, 11] },

  // --- Funds (Mantle) ---
  SPY: { name: "S&P 500", ticker: "SPY", logo: logoUrl("SPYx"), color: "#1f6f54", kind: "fund", cat: "Funds", desc: "One fund that holds the 500 largest US companies at once, so your money is spread across the whole American market instead of a single stock. A common starting point for new investors.", price: 583.27, day: 0.34, spark: [6, 6, 7, 7, 7, 8, 8, 8, 9, 9] },
  QQQ: { name: "Nasdaq-100", ticker: "QQQ", logo: logoUrl("QQQx"), color: "#1c8a6e", kind: "fund", cat: "Funds", desc: "A fund that holds the 100 largest non-financial companies on the Nasdaq, weighted toward big technology names like Apple, Nvidia, and Microsoft.", price: 511.86, day: 0.68, spark: [5, 6, 6, 7, 8, 8, 9, 9, 10, 11] },

  // --- More ---
  HOOD: { name: "Robinhood", ticker: "HOOD", logo: logoUrl("HOODx"), color: "#3d8a3d", kind: "stock", cat: "More", desc: "Robinhood runs a popular app for buying stocks and crypto. Here you own a piece of the company itself, which earns money as more people trade.", price: 41.92, day: 3.04, spark: [4, 5, 5, 6, 6, 7, 8, 9, 9, 11] },
  CRCL: { name: "Circle", ticker: "CRCL", logo: logoUrl("CRCLx"), color: "#2f6fd0", glyph: "C", kind: "stock", cat: "More", desc: "Circle is the company behind USDC, one of the largest digital dollars used across crypto. It earns income on the reserves that back the coin.", price: 38.5, day: 1.88, spark: [5, 5, 6, 6, 7, 7, 8, 8, 9, 9] },
  COIN: { name: "Coinbase", ticker: "COIN", logo: logoUrl("COINx"), color: "#1652f0", glyph: "C", kind: "stock", cat: "More", desc: "Coinbase is the largest crypto exchange in the US and the company that issues the tokenized stocks on Base. It earns fees when people trade, so its price tends to rise and fall with the crypto market.", price: 245.3, day: 2.2, spark: [5, 6, 5, 7, 7, 8, 9, 8, 10, 11] },
  MSTR: { name: "Strategy", ticker: "MSTR", logo: logoUrl("MSTRx"), color: "#d08a2a", kind: "stock", cat: "More", desc: "Strategy (formerly MicroStrategy) is a software firm best known for holding one of the largest corporate stashes of Bitcoin, so its price tends to follow Bitcoin closely.", price: 392.77, day: -2.1, spark: [9, 10, 8, 9, 7, 8, 6, 7, 5, 6] },

  // --- Safer ---
  // Base: USDC parked in Aave, earning a variable rate. aUSDC grows in place, so
  // its balance ticks up over time while the price stays at $1.
  aUSDC: { name: "Safe Dollars", ticker: "aUSDC", logo: "/icons/usdc.svg", color: "#2e6f5e", glyph: "$", kind: "safe", cat: "Safer", desc: "Your dollars, lent out on Aave, a long-running savings pool, and earning a steady rate while they sit there. Take them back to cash anytime. The rate moves with demand and isn't guaranteed.", price: 1.0, apy: "~3.8%", day: 0.01, spark: [8, 8, 8, 8, 9, 9, 9, 9, 10, 10] },
  // Mantle: sUSDe DISABLED 2026-06-30: its Agni USDe<>sUSDe pool (0x07277…fBfc) drained to
  // ZERO in-range liquidity, so both buy and sell revert (empty 0x) during the
  // gasless UserOp simulation. No other venue is usable (Fluxion/Agni "no route";
  // Merchant Moe routes but ~93% price impact). Flagged `coming` to pull it from
  // the buy/sell UI and the AI universe (see lib/server/allocate.ts BUYABLE).
  // Re-enable once a liquid USDC route exists (add a validated route entry),
  // or mint via Ethena's StakedUSDe vault (deposit USDe) instead of a DEX swap.
  sUSDe: { name: "Safe Dollars", ticker: "sUSDe", logo: "https://assets.coingecko.com/coins/images/33613/small/USDE.png", color: "#c19a52", glyph: "$", kind: "safe", cat: "Safer", desc: "A dollar-based savings asset that grows in value as it earns a steady yield, so its price sits a little above $1 and drifts up over time. It's the calmest option here, though the rate moves and isn't guaranteed.", price: 1.23, apy: "4.8%", day: 0.01, coming: true, spark: [8, 8, 8, 8, 9, 9, 9, 9, 10, 10] },
  // Ondo RWA dollars — both REAL on Mantle but not yet buyable in-app (KYC mint/redeem
  // + no DEX liquidity), so shown as `coming`. USDY is the accumulating token (price
  // drifts up); mUSD is its $1-pegged rebasing wrapper. Prices/apy are indicative.
  USDY: { name: "US Treasuries", ticker: "USDY", logo: "https://assets.coingecko.com/coins/images/31700/standard/usdy_%281%29.png?1696530524", color: "#2e6f5e", glyph: "$", kind: "safe", cat: "Safer", desc: "Ondo's USDY is backed by short-term US Treasuries, the safest corner of the market, and pays a steady yield. It's live on Mantle; we're adding it to Stax once it can be bought without paperwork.", price: 1.06, apy: "~4.5%", day: 0.01, coming: true, spark: [8, 8, 8, 9, 9, 9, 9, 9, 10, 10] },
  mUSD: { name: "Mantle USD", ticker: "mUSD", logo: "https://assets.coingecko.com/coins/images/31700/standard/usdy_%281%29.png?1696530524", color: "#2f7d9c", glyph: "$", kind: "safe", cat: "Safer", desc: "The dollar-stable version of USDY: it stays at about $1 while quietly paying out yield in extra tokens. Same US Treasury backing, live on Mantle, coming to Stax once it's freely tradable.", price: 1.0, apy: "~4.5%", day: 0, coming: true, spark: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8] },

  // --- Crypto ---
  // Base: cbBTC (Coinbase-wrapped Bitcoin) and WETH, both deep Uniswap pools.
  BTC: { name: "Bitcoin", ticker: "BTC", logo: `${CRYPTO_ICON}/btc.svg`, color: "#d08a2a", glyph: "B", kind: "crypto", cat: "Crypto", desc: "The original and largest cryptocurrency, held here as cbBTC, a version issued by Coinbase and backed one-to-one by real Bitcoin. Known for large ups and downs.", price: 96250.0, day: 1.4, spark: [6, 7, 6, 8, 7, 9, 8, 10, 9, 11] },
  ETH: { name: "Ethereum", ticker: "ETH", logo: `${CRYPTO_ICON}/eth.svg`, color: "#5b7fd0", glyph: "E", kind: "crypto", cat: "Crypto", desc: "Ether is the coin that runs the Ethereum network, the system most of crypto and tokenized finance is built on (Base included). Crypto, so expect bigger swings than a stock.", price: 1830.0, day: 0.9, spark: [5, 6, 6, 7, 6, 7, 8, 8, 9, 9] },
  // Mantle: mETH routes through Agni (validated); FBTC has no clean single-router
  // USDC route, so it stays honestly flagged `coming`.
  mETH: { name: "Staked ETH", ticker: "mETH", logo: `${CRYPTO_ICON}/eth.svg`, color: "#5b7fd0", kind: "crypto", cat: "Crypto", desc: "Ethereum that's staked to help secure the network, earning a steady staking reward on top of Ether's own price moves. Crypto, so expect bigger swings.", price: 1830.0, apy: "3.6%", day: 0.9, spark: [5, 6, 6, 7, 6, 7, 8, 8, 9, 9] },
  FBTC: { name: "Bitcoin", ticker: "FBTC", logo: `${CRYPTO_ICON}/btc.svg`, color: "#d08a2a", glyph: "B", kind: "crypto", cat: "Crypto", desc: "A tokenized form of Bitcoin, the original and largest cryptocurrency, giving you Bitcoin's price exposure on Mantle. Known for large ups and downs.", price: 96250.0, day: 1.4, coming: true, spark: [6, 7, 6, 8, 7, 9, 8, 10, 9, 11] },
  // BNB Chain: BTCB (a version of Bitcoin moved onto BNB Chain) and BNB itself (held on-chain as
  // WBNB), both traded through the same Binance aggregator as the tokenized stocks. No logo for
  // "btcb" in the shared crypto-icon set, so it reuses the plain Bitcoin glyph.
  BTCB: { name: "Bitcoin", ticker: "BTCB", logo: `${CRYPTO_ICON}/btc.svg`, color: "#d08a2a", glyph: "B", kind: "crypto", cat: "Crypto", desc: "A version of the original cryptocurrency, moved onto BNB Chain and backed one-to-one by real Bitcoin. Known for large ups and downs.", price: 84000.0, day: 0, spark: [6, 7, 6, 8, 7, 9, 8, 10, 9, 11] },
  BNB: { name: "BNB", ticker: "BNB", logo: `${CRYPTO_ICON}/bnb.svg`, color: "#F0B90B", glyph: "B", kind: "crypto", cat: "Crypto", desc: "BNB Chain's own coin, held here as WBNB. Used across the network to pay fees. Crypto, so expect bigger swings than a stock.", price: 780.0, day: 0, spark: [5, 6, 6, 7, 6, 7, 8, 8, 9, 9] },
};

const FALLBACK_COLORS = ["#3b3f44", "#1f6f54", "#356ac3", "#b03a2e", "#4a7d2c"];

/** Strip issuer suffixes from a registry name ("Bitcoin (cbBTC)" → "Bitcoin"). */
function cleanName(symbol: string, name?: string): string {
  const n = (name ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  return n || symbol;
}

function fallback(symbol: string, name?: string): AssetDisplay {
  const color = FALLBACK_COLORS[symbol.charCodeAt(0) % FALLBACK_COLORS.length];
  const display = cleanName(symbol, name);
  return {
    name: display,
    ticker: symbol,
    color,
    glyph: display[0].toUpperCase(),
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
