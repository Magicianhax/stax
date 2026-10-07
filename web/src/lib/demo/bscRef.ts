// Reference numbers for the BNB Chain demo: one "real share" price and one day move per ticker,
// so every demo screen (Home, Market, Asset, Trade, Plan, Wallet) prices a stock the same way.
// Everything here is invented for the demo (rounded, indicative, not a quote); nothing is read
// from Binance, and no real person or account is involved.
//
// `displayForDemo` is displayFor with two gaps filled: tickers the design table has no price for
// (most of the 42 on BSC) get one from here, and every ticker gets a believable day move, so the
// seeded charts (lib/demoSeries.ts) and sparklines have a shape instead of a flat line.
import { displayFor, type AssetDisplay } from "@/lib/displayAssets";

/** Real-share price in dollars, for tickers lib/displayAssets.ts has no price for. */
const EXTRA_PRICE: Record<string, number> = {
  AAOI: 36.2,
  AMD: 164.8,
  ARM: 138.4,
  AVGO: 232.6,
  AXTI: 6.4,
  BABA: 118.3,
  CBRS: 24.0,
  CRWV: 94.7,
  DRAM: 28.9,
  EWY: 71.5,
  GLW: 52.1,
  IBM: 241.3,
  INTC: 24.8,
  LITE: 112.4,
  MRVL: 78.6,
  MU: 118.9,
  NBIS: 58.3,
  NOK: 5.4,
  ORCL: 197.2,
  PLTR: 142.7,
  QCOM: 158.5,
  RKLB: 34.1,
  SKHY: 205.0,
  SNDK: 61.8,
  SOXL: 31.2,
  TQQQ: 82.4,
  TSM: 207.9,
  WDC: 74.5,
};

/** One day's move in percent, where lib/displayAssets.ts has none (its `day` is 0 for crypto and every fallback). */
const EXTRA_DAY: Record<string, number> = {
  AAOI: 3.4,
  AMD: -1.1,
  ARM: 1.9,
  AVGO: 0.6,
  AXTI: 4.8,
  BABA: -0.7,
  CBRS: 2.2,
  CRWV: 3.9,
  DRAM: 1.4,
  EWY: 0.3,
  GLW: -0.4,
  IBM: 0.2,
  INTC: -1.6,
  LITE: 2.7,
  MRVL: 1.2,
  MU: 2.1,
  NBIS: 4.1,
  NOK: -0.9,
  ORCL: 0.8,
  PLTR: 2.6,
  QCOM: -0.3,
  RKLB: 3.2,
  SKHY: 1.7,
  SNDK: 2.9,
  SOXL: 4.6,
  TQQQ: 2.8,
  TSM: 1.3,
  WDC: 1.0,
  BTCB: 1.6,
  ETH: 2.1,
  BNB: 0.7,
};

/** A 10-point sparkline that ends where `day` says it should, for tickers with no designed one. */
function sparkFor(symbol: string, day: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i++) h = Math.imul(h ^ symbol.charCodeAt(i), 16777619);
  const out: number[] = [];
  const start = 8;
  const end = start * (1 + day / 25);
  for (let i = 0; i < 10; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    const wobble = ((h % 1000) / 1000 - 0.5) * 0.9;
    out.push(Number((start + ((end - start) * i) / 9 + (i > 0 && i < 9 ? wobble : 0)).toFixed(3)));
  }
  return out;
}

/** displayFor + the demo's own price, day move and sparkline for tickers the design table lacks. */
export function displayForDemo(symbol: string, name?: string): AssetDisplay {
  const d = displayFor(symbol, name);
  const price = d.price ?? EXTRA_PRICE[symbol];
  const hasDesignedDay = d.day !== 0 && !(symbol in EXTRA_DAY);
  const day = hasDesignedDay ? d.day : (EXTRA_DAY[symbol] ?? d.day);
  const spark = hasDesignedDay ? d.spark : sparkFor(symbol, day);
  return { ...d, ...(price !== undefined ? { price } : {}), day, spark };
}

/** The real share's price (dollars) the demo uses for `symbol`, or undefined for an unknown ticker. */
export function demoRefPrice(symbol: string): number | undefined {
  return displayForDemo(symbol).price;
}

/** The demo's day move for `symbol`, in percent. */
export function demoDayPct(symbol: string): number {
  return displayForDemo(symbol).day;
}
