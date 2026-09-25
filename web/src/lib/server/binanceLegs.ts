import "server-only";

// A single BSC leg through the Binance Web3 DEX aggregator (docs/BINANCE-WEB3.md §4), and the
// exact-amount approve + swap calls for the direct smart-account path (ADR-0005). Used by
// /api/swap-quote (manual buy/sell, this wave) and by legBuilder.ts's `via === "binance"`
// branch (the executor path, inert until the human deploys StaxExecutor on BSC — Task 10).
//
// Review Focus #5: a contract cannot sign an RFQ order, and an unrecognised router is an
// attack surface, so both `quote.executionMode` and the swap's `tx.to` are checked against
// `chain.routers.binance` before anything is returned for signing — mirrors
// `assertWhitelistedRouter` in server/kyber.ts.
//
// The Task 6 client already retries a transient 429/418 with backoff inside `web3Request`
// (see rateLimit.ts); this file adds no second retry layer. A `BinanceWeb3Error` reaching here
// is the client's FINAL word (retries exhausted), and is rethrown naming the leg's symbol so a
// basket failure or a swap-quote 502 tells the user which asset stalled, not just "Binance
// error 429".
import { encodeFunctionData } from "viem";
import { ERC20_ABI } from "@/lib/abis";
import { fromUnits } from "@/lib/format";
import { formatNextOpen, nextUsOpenMs } from "@/lib/marketHours";
import { BSC_MIN_LEG_USD, isBuyable } from "@/lib/rwa";
import { rawToUsd } from "@/lib/units";
import type { ExecCall } from "@/lib/execution";
import type { Asset, StaxChain } from "@/lib/chains/types";
import { getBinanceWeb3 } from "./binance";
import { cached } from "./cache";
import { BinanceWeb3Error } from "./binance/types";
import type { RwaToken } from "./binance/types";

const BPS = BigInt(10_000);

export interface BinanceLegArgs {
  chain: StaxChain;
  /** Display name for error messages — never used to look anything up. */
  symbol: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  /** The account that will call the router: the smart account (direct) or the executor. */
  taker: `0x${string}`;
  slippageBps: number;
  /**
   * USD value of this leg, computed by the caller so the $6 floor is enforced before any
   * Binance call. For a buy this is trivially `rawToUsd(chain, amountIn)` (tokenIn is cash);
   * for a sell there is no cash amount to read directly, so the caller prices `amountIn`
   * (raw units of the stock token) against the RWA catalog's cached `tokenPrice` — the same
   * lookup swap-quote already does for the market-closed check, never a fresh Binance call
   * made just to size this guard.
   */
  usdValue: number;
  /** False for a price check: quote only, no swap build, and the leg's `swapData` is "0x". */
  build?: boolean;
}

export interface BinanceLeg {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  swapData: `0x${string}`;
  minOut: bigint;
  expectedOut: bigint;
  priceImpactPct: number;
}

/**
 * A final (retries exhausted) failure from Binance itself — an upstream problem, not a bad
 * request. Callers (e.g. /api/swap-quote) map this to a 502; every other error out of
 * `buildBinanceLeg` (the $6 floor, an RFQ route, an unrecognised router) is the caller's to
 * fix and maps to a 400.
 */
export class BinanceLegError extends Error {}

/**
 * A leg Stax itself refuses (the $6 floor, an RFQ route, an unrecognised router). Its message
 * is written for the user, so /api/swap-quote returns it as a 400. Anything that is neither
 * this nor a BinanceLegError is an internal fault and is never echoed to the browser.
 */
export class BinanceLegRefusal extends Error {}

/** Wraps a final BinanceWeb3Error with the leg's token so a basket/quote failure names it. */
function wrap(symbol: string, err: unknown): never {
  if (err instanceof BinanceWeb3Error) {
    throw new BinanceLegError(`Binance couldn't price ${symbol}: ${err.message}`);
  }
  throw err;
}

/**
 * Quote + build one BSC leg through the Binance aggregator. Refuses under the $6 minimum
 * without calling Binance at all, rejects an RFQ route (a contract can't sign one) and any
 * router that isn't `chain.routers.binance`, and sets `minOut` to whichever is smaller of
 * Binance's own `minReceiveAmount` and our slippage floor on the quoted output — never above
 * what Binance actually guarantees.
 */
export async function buildBinanceLeg(a: BinanceLegArgs): Promise<BinanceLeg> {
  // NaN happens only when a sell's stock side couldn't be priced against the cached catalog —
  // a different problem from the $6 floor below, so it gets its own words instead of also
  // claiming the trade was "too small" when its size was never known.
  if (!Number.isFinite(a.usdValue)) {
    throw new BinanceLegRefusal("Couldn't price this trade right now. Try again in a moment.");
  }
  if (a.usdValue < BSC_MIN_LEG_USD) {
    // Design critique P1 #11: name the next step, not just the rule that was broken. Reviewer
    // follow-up: side-neutral wording, and no leading "NVDA:" — buildBinanceLeg prices both buy
    // and sell legs, and "the smallest buy is $6" told someone selling a $5.70 position (bought
    // at the $6 floor, dipped since, no amount field on the Sell tab to "enter more" into) that
    // they needed to make a bigger BUY.
    throw new BinanceLegRefusal(`The smallest trade is $${BSC_MIN_LEG_USD}. Enter $${BSC_MIN_LEG_USD} or more.`);
  }
  const router = a.chain.routers.binance;
  if (!router) throw new Error(`Binance aggregator isn't configured on ${a.chain.name}.`);

  const binance = getBinanceWeb3();
  const fetchQuote = () =>
    binance.quote({ fromToken: a.tokenIn, toToken: a.tokenOut, amount: a.amountIn, taker: a.taker }).catch((err) => wrap(a.symbol, err));
  // A price check (build=false) is shared for 15 s across every caller asking the same pair and
  // amount: TradeScreen re-polls every 15 s per viewer, and each live quote spends one call of
  // Binance's shared 5-per-window budget that real trades, plan legs and dry runs also need.
  // The swap build always gets a fresh quote.
  const q = a.build === false ? await sharedPriceQuote(a, fetchQuote) : await fetchQuote();
  if (q.executionMode !== "SWAP") {
    throw new BinanceLegRefusal(`${a.symbol}: Binance returned an RFQ route, which a contract can't sign.`);
  }
  if (q.approveTarget.toLowerCase() !== router.toLowerCase()) {
    throw new BinanceLegRefusal(`${a.symbol}: Binance quoted an unexpected router.`);
  }
  if (q.fromTokenAmount !== a.amountIn) {
    throw new BinanceLegRefusal(`${a.symbol}: Binance quoted a different amount than requested.`);
  }

  const slippageFloor = (q.toTokenAmount * (BPS - BigInt(a.slippageBps))) / BPS;
  // A price check (TradeScreen polls every 15 s) needs only the quote. Building the swap is a
  // second call against the shared 5-per-window budget, so it happens only when the user is
  // about to sign, and a price-only leg carries no calldata.
  if (a.build === false) {
    return {
      router,
      tokenIn: a.tokenIn,
      tokenOut: a.tokenOut,
      amountIn: a.amountIn,
      swapData: "0x",
      minOut: slippageFloor,
      expectedOut: q.toTokenAmount,
      priceImpactPct: q.priceImpactPercent,
    };
  }

  const slippagePercent = (a.slippageBps / 100).toString();
  const built = await binance
    .buildSwap({
      fromToken: a.tokenIn,
      toToken: a.tokenOut,
      amount: a.amountIn,
      taker: a.taker,
      quoteId: q.quoteId,
      slippagePercent,
    })
    .catch((err) => wrap(a.symbol, err));
  if (built.executionMode !== "SWAP") {
    throw new BinanceLegRefusal(`${a.symbol}: Binance returned an RFQ route, which a contract can't sign.`);
  }
  if (built.tx.to.toLowerCase() !== router.toLowerCase()) {
    throw new BinanceLegRefusal(`${a.symbol}: Binance's swap calldata targeted an unexpected router.`);
  }
  const minOut = built.tx.minReceiveAmount < slippageFloor ? built.tx.minReceiveAmount : slippageFloor;

  return {
    router,
    tokenIn: a.tokenIn,
    tokenOut: a.tokenOut,
    amountIn: a.amountIn,
    swapData: built.tx.data,
    minOut,
    expectedOut: q.toTokenAmount,
    priceImpactPct: q.priceImpactPercent,
  };
}

/**
 * Review Focus #1: refuse before ever asking Binance for a quote when the issuer isn't
 * trading this token right now. A token the cached catalog doesn't even list is refused too
 * (fail closed) — an address Binance has silently dropped is not one we can price. Pure so
 * /api/swap-quote's 409 path is directly testable without standing up the whole route.
 */
export function checkBscBuyable(
  tokens: RwaToken[],
  tokenAddress: `0x${string}`,
  symbol: string,
  nowMs: number,
): { ok: true; row: RwaToken } | { ok: false; message: string; nextOpenMs?: number } {
  const row = tokens.find((t) => t.tokenContractAddress.toLowerCase() === tokenAddress.toLowerCase());
  if (!row || !isBuyable(row.statusInfo)) {
    // No row at all means Binance has nothing to say about this address — there is no session to
    // report, so this is the one case that carries no `nextOpenMs` (design critique P0 #1: the
    // client falls back to its own "check back" copy rather than inventing a time).
    if (!row) return { ok: false, message: `${symbol} isn't available to trade on BNB Chain right now.` };
    const next = row.statusInfo.nextOpenTime;
    const nextOpenMs = next !== null && next > nowMs ? next : nextUsOpenMs(nowMs);
    // The message stays readable on its own (server logs, or a caller with no client-side
    // formatter) in ET; the client re-formats `nextOpenMs` through marketHours.ts's
    // formatOpensLocal instead of parsing this string, so it always reads in the viewer's zone.
    return {
      ok: false,
      message: `${symbol} is closed right now; it ${formatNextOpen(new Date(nextOpenMs), new Date(nowMs))}.`,
      nextOpenMs,
    };
  }
  return { ok: true, row };
}

/**
 * USD value of a BSC leg, for the $6 floor. A buy's cash side reads straight off the raw
 * amount; a sell has no cash amount to read, so its stock side is priced against the same
 * cached `RwaToken.tokenPrice` `checkBscBuyable` already looked up — never a fresh Binance
 * call made just to size this guard.
 */
export function bscLegUsdValue(side: "buy" | "sell", chain: StaxChain, amountIn: bigint, asset: Asset, row: RwaToken): number {
  if (side === "buy") return rawToUsd(chain, amountIn);
  return fromUnits(amountIn, asset.decimals ?? row.decimals) * row.tokenPrice;
}

/**
 * Direct path (ADR-0005): exact-amount approve of `leg.tokenIn` to the router, then the swap
 * itself. Never a max approval — the next leg (or the next trade) approves its own exact
 * amount. Binance's own delivery is msg.sender-only (docs/BINANCE-WEB3.md §10, resolved live):
 * whoever calls the router receives the output, so the direct path's caller (the user's smart
 * account) receives it correctly with no separate recipient step.
 */
export function directCallsForLeg(leg: BinanceLeg): ExecCall[] {
  return [
    { to: leg.tokenIn, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [leg.router, leg.amountIn] }) },
    { to: leg.router, data: leg.swapData },
  ];
}

/**
 * USD value of a BSC crypto leg (BTCB, ETH, BNB), for the $6 floor. Crypto has no RWA row and no
 * market hours, so it skips checkBscBuyable entirely; a buy reads the cash amount, a sell prices
 * the coins at `priceUsd` (the same Binance quote price the app shows). No price gives NaN, which
 * buildBinanceLeg refuses rather than letting an unpriced sell past the floor.
 */
export function cryptoLegUsdValue(
  side: "buy" | "sell",
  chain: StaxChain,
  amountIn: bigint,
  asset: Asset,
  priceUsd: number | undefined,
): number {
  if (side === "buy") return rawToUsd(chain, amountIn);
  if (priceUsd === undefined || !Number.isFinite(priceUsd) || priceUsd <= 0) return Number.NaN;
  return fromUnits(amountIn, asset.decimals ?? 18) * priceUsd;
}

type Quote = Awaited<ReturnType<ReturnType<typeof getBinanceWeb3>["quote"]>>;
/** JSON-safe copy of the fields a price check reads (bigints don't survive the Redis cache). */
type StoredQuote = Omit<Quote, "fromTokenAmount" | "toTokenAmount" | "raw"> & { fromTokenAmount: string; toTokenAmount: string };

const PRICE_QUOTE_TTL_S = 15;

async function sharedPriceQuote(a: BinanceLegArgs, fetchQuote: () => Promise<Quote>): Promise<Quote> {
  const key = `binance:pq:${a.chain.key}:${a.tokenIn.toLowerCase()}:${a.tokenOut.toLowerCase()}:${a.amountIn}`;
  const stored = await cached<StoredQuote>(key, PRICE_QUOTE_TTL_S, async () => {
    const q = await fetchQuote();
    return {
      quoteId: q.quoteId,
      vendorName: q.vendorName,
      executionMode: q.executionMode,
      priceImpactPercent: q.priceImpactPercent,
      approveTarget: q.approveTarget,
      fromTokenAmount: q.fromTokenAmount.toString(),
      toTokenAmount: q.toTokenAmount.toString(),
    };
  });
  return { ...stored, fromTokenAmount: BigInt(stored.fromTokenAmount), toTokenAmount: BigInt(stored.toTokenAmount), raw: undefined };
}
