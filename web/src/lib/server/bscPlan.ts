import "server-only";

// Pure(ish) BSC planning logic shared by Vera's allocation (lib/server/allocate.ts) and the
// direct-path builder /api/invest-plan uses instead of the executor while chain.contracts.deployed
// is false (ADR-0005). Kept apart from those callers, and apart from Next.js route plumbing, so
// the $6-per-leg rule, the "what's buyable right now" filter, and the calls this plan hands the
// client for signing are all testable without mocking Privy auth or standing up a route — the
// same reasoning binanceLegs.ts gives for keeping checkBscBuyable/bscLegUsdValue pure.
import { assetBySymbol, type StaxChain } from "@/lib/chains";
import { splitByWeight } from "@/lib/legBuilder";
import { formatNextOpen, nextUsOpenMs } from "@/lib/marketHours";
import { BSC_MIN_LEG_USD, type RwaTickerView } from "@/lib/rwa";
import { rawToUsd } from "@/lib/units";
import type { ExecCall } from "@/lib/execution";
import type { Allocation } from "@/lib/allocation-schema";
import { buildBinanceLeg, checkBscBuyable, directCallsForLeg, BinanceLegRefusal } from "./binanceLegs";
import type { RwaToken } from "./binance/types";

/** How many legs $usd can fund on BSC while every leg still clears the $6 floor. */
export function maxBscLegs(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.floor(usd / BSC_MIN_LEG_USD);
}

/** The address a buy of `ticker` should target right now: `bestVenue`'s own row. Null when nothing is buyable. */
export function venueAddressFor(ticker: RwaTickerView | undefined): `0x${string}` | null {
  if (!ticker || !ticker.bestVenue) return null;
  return ticker.venues.find((v) => v.platform === ticker.bestVenue)?.address ?? null;
}

/** Soonest open time across every venue of a ticker, for the "closed" message when none is buyable. */
function soonestOpenMs(ticker: RwaTickerView | undefined, nowMs: number): number {
  if (!ticker || ticker.venues.length === 0) return nextUsOpenMs(nowMs);
  const known = ticker.venues.map((v) => v.nextOpenMs).filter((v): v is number => v !== null);
  return known.length > 0 ? Math.min(...known) : nextUsOpenMs(nowMs);
}

/** Same wording as checkBscBuyable's own closed message, for a ticker with no buyable venue at all. */
export function closedMessage(symbol: string, ticker: RwaTickerView | undefined, nowMs: number): string {
  const openMs = soonestOpenMs(ticker, nowMs);
  return `${symbol} is closed right now; it ${formatNextOpen(new Date(openMs), new Date(nowMs))}.`;
}

/** Vera's BSC candidate universe: catalog tickers with a venue buyable right now. */
export function buyableTickers(tickers: RwaTickerView[]): RwaTickerView[] {
  return tickers.filter((t) => t.bestVenue !== null);
}

/**
 * When every candidate in the catalog is closed (Review Focus #1): one honest message naming
 * the soonest reopen across the whole catalog, never a plan that just comes back empty.
 */
export function allClosedMessage(tickers: RwaTickerView[], nowMs: number): string {
  const known = tickers.flatMap((t) => t.venues.map((v) => v.nextOpenMs)).filter((v): v is number => v !== null);
  const openMs = known.length > 0 ? Math.min(...known) : nextUsOpenMs(nowMs);
  return `The market is closed right now; it ${formatNextOpen(new Date(openMs), new Date(nowMs))}.`;
}

/** One line per unbuyable ticker, e.g. "TSLA (paused)", for Vera's prompt to explain herself. */
export function unavailableNote(t: RwaTickerView, nowMs: number): string {
  const states = [...new Set(t.venues.map((v) => v.state))];
  const openMs = soonestOpenMs(t, nowMs);
  return `${t.ticker} (${states.join("/")}, ${formatNextOpen(new Date(openMs), new Date(nowMs))})`;
}

export interface BscCandidateLeg {
  symbol: string;
  usd: number;
  [key: string]: unknown;
}

export type EnforceMinLegsResult<T> = { ok: true; legs: T[] } | { ok: false; message: string };

/**
 * The $6-per-leg rule (Global Constraint, Review Focus #3), enforced on whatever a caller hands
 * in: drop the smallest legs down to `maxBscLegs(totalUsd)`, renormalise the survivors' `usd` so
 * they still sum to `totalUsd`, and refuse outright — naming the minimum — if even the smallest
 * surviving leg still can't clear it. Generic over `T` so both the AI's raw allocation legs and
 * the invest-plan's resolved (symbol, address, usd) legs can share this one rule.
 */
export function enforceMinLegs<T extends BscCandidateLeg>(legs: T[], totalUsd: number): EnforceMinLegsResult<T> {
  const cap = maxBscLegs(totalUsd);
  if (cap === 0) {
    return { ok: false, message: `$${totalUsd} is below Binance's $${BSC_MIN_LEG_USD} minimum per stock.` };
  }
  if (legs.length === 0) {
    return { ok: false, message: `No stocks are buyable right now to build a plan from.` };
  }
  // Largest first, so the legs kept under the cap are the ones the AI weighted most.
  const kept = [...legs].sort((a, b) => b.usd - a.usd).slice(0, cap);
  const keptTotal = kept.reduce((s, l) => s + l.usd, 0);
  if (keptTotal <= 0) {
    return { ok: false, message: `Each stock needs at least $${BSC_MIN_LEG_USD}; try a larger amount.` };
  }
  // Renormalise onto the exact total so the legs still add up to what the user is investing,
  // not to whatever the kept legs happened to sum to before the drop.
  const renormalised = kept.map((l) => ({ ...l, usd: (l.usd / keptTotal) * totalUsd }));
  const smallest = Math.min(...renormalised.map((l) => l.usd));
  if (smallest < BSC_MIN_LEG_USD - 1e-9) {
    return {
      ok: false,
      message: `Each stock needs at least $${BSC_MIN_LEG_USD}; try a larger amount or fewer picks.`,
    };
  }
  return { ok: true, legs: renormalised };
}

export interface BuildBscInvestCallsArgs {
  chain: StaxChain;
  allocation: Allocation;
  usdcTotal: bigint; // raw units of chain.usdc, already net of any fee
  taker: `0x${string}`;
  catalog: RwaTickerView[];
  tokens: RwaToken[];
  nowMs: number;
  slippageBps?: number;
}

/**
 * The direct smart-account path (ADR-0005): every leg of `allocation`, built through the
 * Binance aggregator against the venue the catalog currently picks best, re-verified buyable
 * right before it is built (a live catalog snapshot can be a few seconds to several minutes
 * stale — cachedWithFallback's outage path can serve it far staler still), and returned as the
 * exact-amount approve + swap calls for one sponsored user op. Any leg that fails — unbuyable,
 * under $6, an RFQ route, an unrecognised router — fails the WHOLE plan with that leg named;
 * nothing partial is ever returned for signing (Review Focus #4/#5).
 */
export async function buildBscInvestCalls(args: BuildBscInvestCallsArgs): Promise<ExecCall[]> {
  const { chain, allocation, usdcTotal, taker, catalog, tokens, nowMs, slippageBps = 100 } = args;
  const byTicker = new Map(catalog.map((t) => [t.ticker, t]));

  const entries = allocation.allocations.map((a) => {
    const asset = assetBySymbol(chain, a.symbol);
    if (!asset || !asset.address) throw new BinanceLegRefusal(`${a.symbol} isn't listed on ${chain.name}.`);
    return { asset, weightPct: a.weightPct };
  });
  const split = splitByWeight(entries, usdcTotal);

  const legCalls = await Promise.all(
    split.map(async ({ asset, usdcIn }) => {
      const ticker = byTicker.get(asset.symbol);
      const address = venueAddressFor(ticker);
      if (!address) throw new BinanceLegRefusal(closedMessage(asset.symbol, ticker, nowMs));
      const gate = checkBscBuyable(tokens, address, asset.symbol, nowMs);
      if (!gate.ok) throw new BinanceLegRefusal(gate.message);
      const leg = await buildBinanceLeg({
        chain,
        symbol: asset.symbol,
        tokenIn: chain.usdc.address,
        tokenOut: address,
        amountIn: usdcIn,
        taker,
        slippageBps,
        usdValue: rawToUsd(chain, usdcIn),
        build: true,
      });
      return directCallsForLeg(leg);
    }),
  );
  return legCalls.flat();
}
