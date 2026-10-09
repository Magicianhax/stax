// The BNB Chain demo's market: a stand-in for what /api/rwa, /api/rwa/spread, /api/earnings and
// /api/swap-quote tell the real app, built without calling Binance (or anything else). Pure
// functions of a clock, so the same inputs give the same market and every screen agrees.
//
// What it models, in the app's own words:
//  - the US stock market's hours (lib/marketHours.ts, the same calendar the real catalog falls
//    back on): open, before the bell, after the bell, overnight, closed (weekend or holiday);
//  - two issuers per stock, bStock and Ondo, each priced a little above or below the real share,
//    and further above it when the market is shut (the premium Vera won't pay);
//  - one issuer paused (TSLA at bStock) so "Who you buy from" has a case where the choice matters;
//  - a Binance check on every trade that always passes here: the demo never contacts Binance.
//
// All numbers are fictional and rounded; none is a quote.
import { BSC, BINANCE_ROUTER } from "@/lib/chains/bsc";
import { resolveVenueAddress } from "@/lib/venues";
import type { Asset, RwaPlatform } from "@/lib/chains";
import type { DryRun } from "@/lib/dryRun";
import type { EarningsMap } from "@/lib/earnings";
import { formatOpensLocal, nextUsOpenMs, usMarketState } from "@/lib/marketHours";
import { BSC_MIN_LEG_USD, gapPct, type MarketState, type RwaListResponse, type RwaTickerView, type VenueView } from "@/lib/rwa";
import {
  classifySpread,
  cheaperIssuerNow,
  compareForBuyer,
  issuerDiffSentence,
  rankIssuerBoard,
  type SpreadBoardResponse,
  type SpreadPoint,
  type SpreadTickerCall,
  type SpreadTickerHistoryResponse,
} from "@/lib/spread";
import { SwapQuoteError } from "@/lib/swapQuote";
import { demoRefPrice } from "@/lib/demo/bscRef";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── The clock ───────────────────────────────────────────────────────────────

/** "live" follows the viewer's own clock; the other two pin the demo market open or shut. */
export type DemoMarketMode = "live" | "open" | "closed";

/**
 * The instant the demo market is read at. "live" is the real clock. "open" is the real clock if
 * the US market is in its regular session, else two hours into the next one. "closed" is the
 * real clock if the market is fully shut (weekend or holiday), else the first such hour ahead,
 * which is always within a week.
 */
export function demoClock(mode: DemoMarketMode, realNowMs: number): number {
  if (mode === "open") {
    if (usMarketState(realNowMs) === "open") return realNowMs;
    return nextUsOpenMs(realNowMs) + 2 * HOUR;
  }
  if (mode === "closed") {
    for (let i = 0; i <= 8 * 24; i++) {
      const t = realNowMs + i * HOUR;
      if (usMarketState(t) === "closed") return t;
    }
    return realNowMs;
  }
  return realNowMs;
}

// ── Small deterministic helpers ─────────────────────────────────────────────

/** FNV-1a, folded to [0, 1). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A slow wobble in [-1, 1]: one value per 90-minute bucket, blended between neighbours. */
function wobble(key: string, tMs: number): number {
  const step = 1.5 * HOUR;
  const k = Math.floor(tMs / step);
  const f = (tMs - k * step) / step;
  const a = hash01(`${key}:${k}`) * 2 - 1;
  const b = hash01(`${key}:${k + 1}`) * 2 - 1;
  return a + (b - a) * f;
}

// ── One issuer's state at an instant ────────────────────────────────────────

const PAUSED: Readonly<Record<string, RwaPlatform>> = { TSLA: "bstock" };

interface VenueSession {
  state: MarketState;
  buyable: boolean;
}

/**
 * Whether `platform` fills a buy of `symbol` at `tMs`. Both issuers trade the regular session and
 * the hours either side of it; overnight only Ondo does (it runs a night session, bStock does
 * not); on a weekend or holiday neither does. One demo pause on TSLA at bStock while the market
 * would otherwise be buyable.
 */
export function venueSession(symbol: string, platform: RwaPlatform, tMs: number): VenueSession {
  const us = usMarketState(tMs);
  if (us === "closed") return { state: "closed", buyable: false };
  if (us === "overnight") return { state: "overnight", buyable: platform === "ondo" };
  if (PAUSED[symbol] === platform) return { state: "paused", buyable: false };
  return { state: us, buyable: true };
}

/**
 * How far above (+) or below (-) the real share this issuer's token trades, in percent, at `tMs`.
 * Inside the session it hugs the real price; around and outside it the real price is stale and the
 * token drifts above it, Ondo further than bStock. One discount (AMD at Ondo) while the market is
 * open, for the "buy the discount" story. Pre-IPO names (Cerebras) carry a bigger premium.
 */
export function gapAt(symbol: string, platform: RwaPlatform, tMs: number): number {
  const us = usMarketState(tMs);
  const h = hash01(`${symbol}:${platform}`);
  const n = wobble(`${symbol}:${platform}:gap`, tMs);
  const ondo = platform === "ondo";
  const preipo = symbol === "CBRS";
  let g: number;
  if (us === "open") {
    g = (h - 0.5) * 0.3 + n * 0.18;
    if (symbol === "AMD" && ondo) g = -1.55 + n * 0.15;
  } else if (us === "premarket" || us === "postmarket") {
    g = (ondo ? 0.4 + h * 0.9 : 0.25 + h * 0.55) + n * 0.12;
  } else if (us === "overnight") {
    g = (ondo ? 0.7 + h * 1.5 : 0.5 + h * 1.1) + n * 0.18;
  } else {
    g = (ondo ? 1.2 + h * 3.1 : 0.7 + h * 1.7) + n * 0.3;
  }
  if (preipo && us !== "open") g += 2.4 + h * 1.6;
  return Math.round(g * 100) / 100;
}

/** Trading days elapsed at `tMs`, counting each weekday's 4pm-ish close once (weekends add none). */
function sessionCount(tMs: number): number {
  const d = Math.floor((tMs - 20 * HOUR) / DAY);
  const dayNo = d + 4; // 1970-01-01 was a Thursday; makes dayNo % 7 the weekday with Sunday = 0
  const r = ((dayNo % 7) + 7) % 7;
  return Math.floor(dayNo / 7) * 5 + (r === 0 ? 0 : Math.min(r, 5));
}

/**
 * The real share's price at `tMs`, given that it is `nowMs` now: it only changes on a trading day,
 * so a weekend reads the Friday close, and it ends on today's reference price exactly.
 */
export function referenceAt(symbol: string, tMs: number, nowMs: number): number {
  const base = demoRefPrice(symbol) ?? 100;
  const phase = hash01(`${symbol}:ref`) * 6.28;
  const f = (c: number) => 0.022 * Math.sin(c * 0.85 + phase) + 0.012 * Math.sin(c * 0.31 + phase * 2);
  return r2(base * (1 + f(sessionCount(tMs)) - f(sessionCount(nowMs))));
}

/** The moment the last regular session ended at or before `nowMs` (to the hour), for "updated Xh ago". */
export function lastSessionEndMs(nowMs: number): number {
  if (usMarketState(nowMs) === "open") return nowMs;
  for (let i = 1; i <= 6 * 24; i++) {
    const t = nowMs - i * HOUR;
    if (usMarketState(t) === "open") return t + HOUR;
  }
  return nowMs;
}

// ── The catalog (what /api/rwa returns) ─────────────────────────────────────

const ETF_TICKERS = new Set(["QQQ", "SPY", "EWY", "DRAM", "SOXL", "TQQQ"]);

function venueFor(symbol: string, platform: RwaPlatform, address: `0x${string}`, onchainSymbol: string, tMs: number): VenueView {
  const s = venueSession(symbol, platform, tMs);
  const reference = referenceAt(symbol, tMs, tMs);
  const gap = gapAt(symbol, platform, tMs);
  const token = r2(reference * (1 + gap / 100));
  return {
    platform,
    symbol: onchainSymbol,
    address,
    tokenPrice: token,
    referencePrice: reference,
    gapPct: gapPct(token, reference),
    state: s.state,
    buyable: s.buyable,
    nextOpenMs: s.buyable ? null : nextUsOpenMs(tMs),
    updatedAt: tMs,
  };
}

/** The curated BNB Chain stock catalog as the app's own view models, at `nowMs`. */
export function buildDemoRwa(nowMs: number): RwaListResponse {
  const tickers: RwaTickerView[] = [];
  for (const a of BSC.assets.stocks) {
    if (!a.address || !a.platform) continue;
    const venues: VenueView[] = [venueFor(a.symbol, a.platform, a.address, a.onchainSymbol ?? a.symbol, nowMs)];
    if (a.twin) venues.push(venueFor(a.symbol, a.twin.platform, a.twin.address, a.twin.onchainSymbol, nowMs));
    const buyable = venues.filter((v) => v.buyable);
    tickers.push({
      ticker: a.symbol,
      name: a.name,
      type: ETF_TICKERS.has(a.symbol) ? "etf" : "stock",
      venues,
      bestVenue: buyable.length ? [...buyable].sort(compareForBuyer)[0].platform : null,
    });
  }
  return { tickers, asOf: nowMs };
}

// ── The issuer board (what /api/rwa/spread returns) ─────────────────────────

/** bStock versus Ondo, ranked, plus every ticker's premium or discount call. Same rules as the route. */
export function buildDemoSpreadBoard(rwa: RwaListResponse): SpreadBoardResponse {
  const board = rankIssuerBoard(rwa.tickers).map((row) => ({ ...row, sentence: issuerDiffSentence(row) }));
  const tickers: SpreadTickerCall[] = rwa.tickers.map((t) => ({
    ticker: t.ticker,
    venues: t.venues.map((v) => ({ platform: v.platform, call: classifySpread(v) })),
    cheaperIssuer: cheaperIssuerNow(t.venues),
  }));
  return { asOf: rwa.asOf, board, tickers };
}

const HISTORY_STEP = 1.5 * HOUR;
const HISTORY_POINTS = 112; // seven days

/** A ticker's price against the real share over the last seven days, per issuer; null for an unlisted ticker. */
export function buildDemoSpreadHistory(ticker: string, nowMs: number): SpreadTickerHistoryResponse | null {
  const a = BSC.assets.stocks.find((x) => x.symbol === ticker);
  if (!a || !a.platform) return null;
  const platforms: RwaPlatform[] = [a.platform, ...(a.twin ? [a.twin.platform] : [])];
  const venues = platforms.map((platform) => {
    const points: SpreadPoint[] = [];
    for (let i = HISTORY_POINTS - 1; i >= 0; i--) {
      const t = i === 0 ? nowMs : nowMs - i * HISTORY_STEP;
      const s = venueSession(ticker, platform, t);
      const reference = referenceAt(ticker, t, nowMs);
      const gap = gapAt(ticker, platform, t);
      const token = r2(reference * (1 + gap / 100));
      points.push({ t, tokenPrice: token, referencePrice: reference, gapPct: gapPct(token, reference), buyable: s.buyable, state: s.state });
    }
    return { platform, points };
  });
  return { ticker, venues };
}

// ── Earnings (what /api/earnings returns) ───────────────────────────────────

/** Next results dates, fictional and relative to `nowMs`; funds and pre-IPO names have none. */
export function buildDemoEarnings(nowMs: number): EarningsMap {
  const out: EarningsMap = {};
  const midnight = Math.floor(nowMs / DAY) * DAY;
  for (const a of BSC.assets.stocks) {
    if (ETF_TICKERS.has(a.symbol) || a.risk === "preipo") {
      out[a.symbol] = { nextMs: null, confirmed: false, source: "unavailable" };
      continue;
    }
    const days = 3 + Math.floor(hash01(`${a.symbol}:earn`) * 72);
    out[a.symbol] = { nextMs: midnight + days * DAY + 21 * HOUR, confirmed: days < 38, source: "demo" };
  }
  return out;
}

// ── Quotes and the Binance check (what /api/swap-quote returns) ─────────────

export interface DemoQuote {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  dryRun: DryRun;
}

const E18 = BigInt(10) ** BigInt(18);
/** The demo's price impact on any quote: 0.15% worse than the venue's own price. */
const IMPACT_BPS = 15;
const SLIPPAGE_BPS = 100;

/** dollars -> 18-decimal raw units, exact to the micro-dollar (no float times 1e18). */
function dollarsToRaw(usd: number): bigint {
  return (BigInt(Math.round(usd * 1e6)) * E18) / BigInt(1_000_000);
}
function rawToDollars(raw: bigint): number {
  return Number((raw * BigInt(1_000_000)) / E18) / 1e6;
}

/** The Binance Transaction API check, as it reads when it passes. Never claims more than that. */
export function demoDryRun(symbol: string, token: `0x${string}`, receiveRaw: bigint, nowMs: number): DryRun {
  return { status: "passed", symbol, token, receiveRaw: receiveRaw.toString(), checkedAt: nowMs };
}

function priceOnVenue(asset: Asset, venue: RwaPlatform | undefined, rwa: RwaListResponse): { price: number; view?: VenueView; address: `0x${string}` } | null {
  const resolved = resolveVenueAddress(BSC, asset, venue);
  if (!resolved) return null;
  if (asset.tier === "crypto") {
    const price = demoRefPrice(asset.symbol);
    return price ? { price, address: resolved.address } : null;
  }
  const view = rwa.tickers.find((t) => t.ticker === asset.symbol)?.venues.find((v) => v.address.toLowerCase() === resolved.address.toLowerCase());
  return view ? { price: view.tokenPrice, view, address: resolved.address } : null;
}

/**
 * A buy or sell quote against the demo catalog, with the same refusals the real route makes: a
 * closed or paused issuer ("closed", with when it opens) and a buy of $5 or less ("min_trade").
 * Throws SwapQuoteError, exactly what the screens already know how to word.
 */
export function demoQuote(args: {
  asset: Asset;
  side: "buy" | "sell";
  amountIn: bigint;
  venue?: RwaPlatform;
  rwa: RwaListResponse;
  nowMs: number;
}): DemoQuote {
  const { asset, side, amountIn, rwa, nowMs } = args;
  const priced = priceOnVenue(asset, args.venue, rwa);
  if (!priced || !asset.address) throw new SwapQuoteError(`${asset.symbol} isn't listed on ${BSC.name}.`);
  if (priced.view && !priced.view.buyable) {
    const when = priced.view.nextOpenMs ?? nextUsOpenMs(nowMs);
    throw new SwapQuoteError(`${asset.name} is closed right now; it ${formatOpensLocal(when, nowMs)}.`, "closed", when);
  }
  const cash = BSC.usdc.address;
  const impact = BigInt(10_000 - IMPACT_BPS);
  const bps = BigInt(10_000);
  let amountOut: bigint;
  if (side === "buy") {
    const usd = rawToDollars(amountIn);
    if (usd <= BSC_MIN_LEG_USD - 1) {
      throw new SwapQuoteError(`The smallest buy is $${BSC_MIN_LEG_USD}. Try $${BSC_MIN_LEG_USD} or more.`, "min_trade");
    }
    amountOut = dollarsToRaw(usd / priced.price);
    amountOut = (amountOut * impact) / bps;
  } else {
    const qty = Number((amountIn * BigInt(1_000_000)) / E18) / 1e6;
    amountOut = (dollarsToRaw(qty * priced.price) * impact) / bps;
  }
  const minOut = (amountOut * BigInt(10_000 - SLIPPAGE_BPS)) / bps;
  const tokenIn = side === "buy" ? cash : priced.address;
  const tokenOut = side === "buy" ? priced.address : cash;
  return {
    router: BINANCE_ROUTER,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    minOut,
    dryRun: demoDryRun(asset.symbol, tokenOut, amountOut, nowMs),
  };
}
