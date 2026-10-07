import "server-only";

// Which issuer's token a BSC stock leg buys, decided once for every plan that goes through the
// executor (Vera's plans and baskets via /api/invest-plan, Autopilot's scheduled and rule runs —
// both build legs in lib/legBuilder.ts). bStock and Ondo mint the same share at different
// addresses (chains/bsc.assets.ts); the executor whitelists both, so the leg can buy either one,
// and it must buy the one the person was shown.
//
// Kept apart from bscPlan.ts (which imports legBuilder's splitByWeight) so legBuilder can use it
// without an import cycle; bscPlan re-exports the two helpers that used to live there.
import { formatNextOpen, nextUsOpenMs } from "@/lib/marketHours";
import { resolveVenueAddress } from "@/lib/venues";
import type { RwaPlatform } from "@/lib/chains";
import type { Asset, StaxChain } from "@/lib/chains/types";
import type { RwaTickerView } from "@/lib/rwa";
import { BinanceLegRefusal, checkBscBuyable } from "./binanceLegs";
import type { RwaToken } from "./binance/types";

/** The address a buy of `ticker` should target right now: `bestVenue`'s own row. Null when nothing is buyable. */
export function venueAddressFor(ticker: RwaTickerView | undefined): `0x${string}` | null {
  if (!ticker || !ticker.bestVenue) return null;
  return ticker.venues.find((v) => v.platform === ticker.bestVenue)?.address ?? null;
}

/** Soonest open time across every venue of a ticker, for the "closed" message when none is buyable. */
export function soonestOpenMs(ticker: RwaTickerView | undefined, nowMs: number): number {
  if (!ticker || ticker.venues.length === 0) return nextUsOpenMs(nowMs);
  const known = ticker.venues.map((v) => v.nextOpenMs).filter((v): v is number => v !== null);
  return known.length > 0 ? Math.min(...known) : nextUsOpenMs(nowMs);
}

/** Same wording as checkBscBuyable's own closed message, for a ticker with no buyable venue at all. */
export function closedMessage(symbol: string, ticker: RwaTickerView | undefined, nowMs: number): string {
  const openMs = soonestOpenMs(ticker, nowMs);
  return `${symbol} is closed right now; it ${formatNextOpen(new Date(openMs), new Date(nowMs))}.`;
}

/** `addr` when it is one of `asset`'s own tokens (its default issuer or its twin), else undefined. */
function ownToken(asset: Asset, addr: string | null | undefined): `0x${string}` | undefined {
  if (!addr) return undefined;
  const lower = addr.toLowerCase();
  return [asset.address, asset.twin?.address].find((a): a is `0x${string}` => Boolean(a) && a!.toLowerCase() === lower);
}

export interface ResolveBscStockTokenArgs {
  chain: StaxChain;
  asset: Asset;
  /** The allocation entry's issuer choice, as the plan screen showed it ("From Ondo · ..."). */
  planned: { venue?: RwaPlatform; address?: string };
  /** The live catalog row for this ticker (undefined when the catalog has none). */
  ticker: RwaTickerView | undefined;
  /** Binance's cached RWA token list: the buyable gate's source of truth. */
  tokens: RwaToken[];
  nowMs: number;
}

/**
 * The token a BSC stock leg buys, re-checked buyable right now. In order:
 *   1. the plan's own issuer — its `venue` (what PlanScreen shows), else its `address` — while
 *      that is still one of this asset's tokens and still buyable;
 *   2. otherwise the catalog's current best issuer (the planned one stopped trading, or the plan
 *      named none: a basket, an older plan) — the same fallback the direct path makes;
 *   3. otherwise, when the catalog has no row for the ticker at all, the asset's own default.
 * Whatever 2 or 3 lands on must pass checkBscBuyable against the cached rwaTokens; if it doesn't,
 * this throws the same uncoded BinanceLegRefusal the direct path throws (bscPlan.ts), so
 * /api/invest-plan shows the same plain "X is closed right now; it opens ..." and the whole plan
 * stops — nothing partial. A plan comes from the client, so an address that isn't this asset's
 * own bStock or Ondo token is never honoured.
 */
export function resolveBscStockToken(a: ResolveBscStockTokenArgs): `0x${string}` {
  const { chain, asset, planned, ticker, tokens, nowMs } = a;
  const byVenue = planned.venue ? resolveVenueAddress(chain, asset, planned.venue)?.address : undefined;
  const chosen = ownToken(asset, byVenue) ?? ownToken(asset, planned.address);
  if (chosen && checkBscBuyable(tokens, chosen, asset.symbol, nowMs).ok) return chosen;

  const fallback = ticker ? ownToken(asset, venueAddressFor(ticker)) : asset.address;
  if (!fallback) throw new BinanceLegRefusal(closedMessage(asset.symbol, ticker, nowMs));
  const gate = checkBscBuyable(tokens, fallback, asset.symbol, nowMs);
  if (!gate.ok) throw new BinanceLegRefusal(gate.message);
  return fallback;
}
