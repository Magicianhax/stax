// Builds StaxExecutor `Leg[]` from an AI Allocation on a given StaxChain.
//
// Leg kinds (see docs/MULTICHAIN.md):
//   - single-hop V3   asset has `pool` + `feeTier` → `chain.routers.v3`
//                     (Fluxion `exactInputSingle` WITH deadline on Mantle,
//                      Uniswap SwapRouter02 `exactInputSingle` WITHOUT deadline on Base)
//   - multi-hop V3    `chain.routes[symbol]` → `exactInput(path)` on the route's router
//                     (Agni on Mantle, Router02 when route.kind === "uniswap_v3")
//   - Aave v3 supply  asset.via === "aave_v3" → Pool.supply(USDC, amt, executor, 0) → aToken
//   - Kyber           chains with `chain.routers.kyber` (Base): EVERY non-Aave leg is routed by
//                     the KyberSwap aggregator — GET /routes then POST /route/build with
//                     sender = recipient = executor, so the router pulls USDC from the executor's
//                     per-leg approval and drops the asset on the executor, which forwards it.
//                     No route + a `pool` ⇒ Router02 single-hop fallback; no route + no pool ⇒
//                     the leg is dropped (noted) and the remaining weights re-split.
//   - `coming` assets (and anything with no validated route) are DROPPED and the
//     remaining weights re-normalized; `notes` surfaces that so the UI stays honest.
//
// Quoting: on chains with a QuoterV2 (Base) we simulate `quoteExactInputSingle` /
// `quoteExactInput` for the expected output (real price impact on thin pools) and fall
// back to the pool `slot0` spot estimate if the quoter call fails. Elsewhere the spot
// estimate is the quote. Either way the on-chain `amountOutMinimum` is what actually
// protects the user.
import { concatHex, encodeFunctionData, numberToHex, type PublicClient } from "viem";
import {
  AAVE_POOL_ABI,
  AGNI_ROUTER_ABI,
  FLUXION_ROUTER_ABI,
  UNISWAP_QUOTER_V2_ABI,
  UNISWAP_ROUTER02_ABI,
  V3_POOL_ABI,
} from "./abis";
import { priceLimitSqrtX96 } from "./swapGuards";
import { assetBySymbol } from "./chains";
import { kyberBuild, kyberRoute } from "./server/kyber";
import { buildBinanceLeg } from "./server/binanceLegs";
import { resolveBscStockToken } from "./server/bscLegToken";
import { loadBscMarket, type BscMarket } from "./server/bscMarket";
import { rawToUsd } from "./units";
import type { Asset, AssetRoute, RouteHop, RwaPlatform, StaxChain } from "./chains/types";
import type { Allocation } from "./allocation-schema";

const ZERO = BigInt(0);
const Q96 = BigInt(2) ** BigInt(96);
const Q192 = Q96 * Q96;
const BPS = BigInt(10000);
const DEFAULT_SLIPPAGE_BPS = 100; // 1% buffer on the quote -> minOut
/** Units of USDC an aToken balance may round away (see aaveMinOut). */
const AAVE_ROUNDING_UNITS = BigInt(5);
const DEADLINE_SECONDS = 15 * 60;

export interface Leg {
  router: `0x${string}`;
  tokenOut: `0x${string}`;
  usdcIn: bigint;
  minOut: bigint;
  swapData: `0x${string}`;
}

export interface BuildLegsResult {
  legs: Leg[];
  usdcTotal: bigint;
  notes: string[];
}

export interface BuildLegsArgs {
  chain: StaxChain;
  allocation: Allocation;
  usdcTotal: bigint; // total USDC in 6dp raw units
  client: PublicClient;
  nowSeconds: number; // request-time clock, passed in (never read at module scope)
  slippageBps?: number;
  /**
   * BSC only: the RWA catalog + Binance token list a stock leg's issuer and buyable gate are read
   * from. /api/invest-plan passes the snapshot it already read; when absent (Autopilot) it is
   * loaded on demand, and only when the plan has a stock leg on Binance.
   */
  bscMarket?: BscMarket;
}

/**
 * Spot expected token-out for a given USDC-in, from the pool sqrtPriceX96.
 * price (token1 per token0) = (sqrtP / 2^96)^2, in raw-unit terms.
 * We branch on token ordering so this works regardless of which side USDC is.
 */
function expectedOutFromSqrt(
  sqrtPriceX96: bigint,
  amountInRaw: bigint,
  tokenInIsToken0: boolean,
): bigint {
  // priceX192 = sqrtP^2  (represents token1/token0 * 2^192)
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  if (tokenInIsToken0) {
    // out(token1) = in(token0) * price = in * priceX192 / 2^192
    return (amountInRaw * priceX192) / Q192;
  }
  // tokenIn is token1 => out(token0) = in(token1) / price = in * 2^192 / priceX192
  if (priceX192 === ZERO) return ZERO;
  return (amountInRaw * Q192) / priceX192;
}

/**
 * Encode a Uniswap-V3-style `exactInput` path: abi.encodePacked of
 * token (20 bytes) + fee (uint24, 3 bytes) + token + fee + ... + finalToken.
 */
function encodeV3Path(hops: RouteHop[]): `0x${string}` {
  const parts: `0x${string}`[] = [hops[0].tokenIn];
  for (const h of hops) {
    parts.push(numberToHex(h.fee, { size: 3 }));
    parts.push(h.tokenOut);
  }
  return concatHex(parts);
}

/** Read a pool's slot0.sqrtPriceX96 + token0 (batched into one multicall by the client). */
async function readPool(client: PublicClient, pool: `0x${string}`) {
  const [slot0, token0] = await Promise.all([
    client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "token0" }),
  ]);
  return {
    sqrtPriceX96: (slot0 as readonly bigint[])[0],
    token0: (token0 as string).toLowerCase(),
  };
}

/**
 * Chain the spot price across a route's hops to get expected final-token out for a
 * USDC-in. Spot estimate only — the on-chain amountOutMinimum is the real protection.
 */
async function spotOutAlongRoute(
  client: PublicClient,
  route: AssetRoute,
  usdcInRaw: bigint,
): Promise<bigint> {
  const pools = await Promise.all(route.hops.map((h) => readPool(client, h.pool)));
  let amount = usdcInRaw;
  for (let i = 0; i < route.hops.length; i++) {
    const h = route.hops[i];
    const tokenInIsToken0 = pools[i].token0 === h.tokenIn.toLowerCase();
    amount = expectedOutFromSqrt(pools[i].sqrtPriceX96, amount, tokenInIsToken0);
    if (amount === ZERO) return ZERO;
  }
  return amount;
}

/** QuoterV2 single-hop quote (Base). Returns undefined on any failure so callers fall back. */
async function quoterSingle(
  client: PublicClient,
  quoter: `0x${string}`,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fee: number,
  amountIn: bigint,
): Promise<bigint | undefined> {
  try {
    const { result } = await client.simulateContract({
      address: quoter,
      abi: UNISWAP_QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: ZERO }],
    });
    const out = (result as readonly bigint[])[0];
    return out > ZERO ? out : undefined;
  } catch {
    return undefined;
  }
}

/** QuoterV2 multi-hop quote (Base). Returns undefined on any failure so callers fall back. */
async function quoterPath(
  client: PublicClient,
  quoter: `0x${string}`,
  path: `0x${string}`,
  amountIn: bigint,
): Promise<bigint | undefined> {
  try {
    const { result } = await client.simulateContract({
      address: quoter,
      abi: UNISWAP_QUOTER_V2_ABI,
      functionName: "quoteExactInput",
      args: [path, amountIn],
    });
    const out = (result as readonly unknown[])[0] as bigint;
    return out > ZERO ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Split usdcTotal across symbols by weight; last leg absorbs rounding dust.
 * Exported for lib/legBuilder.test.ts — it divides real money and is worth pinning.
 */
export function splitByWeight(
  entries: { asset: Asset; weightPct: number }[],
  usdcTotal: bigint,
): { asset: Asset; usdcIn: bigint }[] {
  const totalWeight = entries.reduce((s, e) => s + e.weightPct, 0);
  if (totalWeight <= 0) return [];

  // Each leg takes its share of what is still UNALLOCATED, not of the original total, and
  // the last takes whatever is left. Exact by construction — nothing is lost or invented —
  // and the unavoidable sub-unit dust is spread across the split instead of piling onto the
  // final leg. The earlier version rounded each weight to whole basis points, which cannot
  // express a third: a 12-holding basket at $10,000 gave eleven legs $833.00 and the last
  // $837.00. Now every leg lands within one micro-USDC of its true share.
  //
  // The ratio is a double (~15 significant digits, far more than the 4 that bps allowed);
  // the amount stays a bigint. Number() on the remaining amount is exact well past the
  // $1,000,000 per-plan cap — a micro-USDC total only loses precision above ~$9 billion —
  // and sum exactness does not depend on the ratio's precision either way, because every
  // step subtracts what it actually handed out.
  let remainingAmount = usdcTotal;
  let remainingWeight = totalWeight;
  const out = entries.map((e, i) => {
    let usdcIn: bigint;
    if (i === entries.length - 1) {
      usdcIn = remainingAmount; // whatever is left -> no dust left behind
    } else {
      const share = remainingWeight > 0 ? Math.max(0, e.weightPct) / remainingWeight : 0;
      usdcIn = BigInt(Math.floor(Number(remainingAmount) * share));
      if (usdcIn < ZERO) usdcIn = ZERO;
      remainingAmount -= usdcIn;
      remainingWeight -= e.weightPct;
    }
    return { asset: e.asset, usdcIn };
  });
  return out.filter((o) => o.usdcIn > ZERO);
}

/** Single-hop V3 leg (USDC -> asset via `chain.routers.v3`, recipient = executor). */
async function buildSingleHopLeg(
  chain: StaxChain,
  client: PublicClient,
  asset: Asset,
  usdcIn: bigint,
  slippageBps: bigint,
  deadline: bigint,
): Promise<Leg> {
  const pool = asset.pool!;
  const tokenOut = asset.address!;
  const fee = asset.feeTier ?? 3000;
  const usdc = chain.usdc.address;
  const executor = chain.contracts.executor;

  const { sqrtPriceX96, token0 } = await readPool(client, pool);
  const usdcIsToken0 = token0 === usdc.toLowerCase();

  // Expected out: exact quote (incl. price impact) when a QuoterV2 exists, else spot.
  const quoted = chain.routers.quoterV2
    ? await quoterSingle(client, chain.routers.quoterV2, usdc, tokenOut, fee, usdcIn)
    : undefined;
  const expectedOut = quoted ?? expectedOutFromSqrt(sqrtPriceX96, usdcIn, usdcIsToken0);
  const minOut = (expectedOut * (BPS - slippageBps)) / BPS;
  // USDC is tokenIn, so zeroForOne == (USDC is token0). Wide price-impact ceiling
  // on top of the precise minOut floor (see swapGuards.ts).
  const sqrtLimit = priceLimitSqrtX96(sqrtPriceX96, usdcIsToken0);

  const swapData =
    chain.routers.v3Kind === "fluxion"
      ? encodeFunctionData({
          abi: FLUXION_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: usdc,
              tokenOut,
              fee,
              recipient: executor, // executor receives, then forwards to caller
              deadline,
              amountIn: usdcIn,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: sqrtLimit,
            },
          ],
        })
      : encodeFunctionData({
          abi: UNISWAP_ROUTER02_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: usdc,
              tokenOut,
              fee,
              recipient: executor,
              amountIn: usdcIn,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: sqrtLimit,
            },
          ],
        });
  return { router: chain.routers.v3, tokenOut, usdcIn, minOut, swapData };
}

/** Multi-hop V3 `exactInput` leg along a validated route (recipient = executor). */
async function buildRouteLeg(
  chain: StaxChain,
  client: PublicClient,
  asset: Asset,
  route: AssetRoute,
  usdcIn: bigint,
  slippageBps: bigint,
  deadline: bigint,
): Promise<Leg> {
  const tokenOut = asset.address ?? route.hops[route.hops.length - 1].tokenOut;
  const executor = chain.contracts.executor;
  const path = encodeV3Path(route.hops);

  const quoted =
    route.kind === "uniswap_v3" && chain.routers.quoterV2
      ? await quoterPath(client, chain.routers.quoterV2, path, usdcIn)
      : undefined;
  const expectedOut = quoted ?? (await spotOutAlongRoute(client, route, usdcIn));
  const minOut = (expectedOut * (BPS - slippageBps)) / BPS;

  const swapData =
    route.kind === "uniswap_v3"
      ? encodeFunctionData({
          abi: UNISWAP_ROUTER02_ABI,
          functionName: "exactInput",
          args: [{ path, recipient: executor, amountIn: usdcIn, amountOutMinimum: minOut }],
        })
      : encodeFunctionData({
          abi: AGNI_ROUTER_ABI,
          functionName: "exactInput",
          args: [{ path, recipient: executor, deadline, amountIn: usdcIn, amountOutMinimum: minOut }],
        });
  return { router: route.router, tokenOut, usdcIn, minOut, swapData };
}

/**
 * Aave v3 supply leg: USDC -> aToken 1:1 (recipient = executor, which forwards the aToken).
 *
 * The tolerance is not slippage — there is no market here, a supply either
 * happens or it does not. It exists because an aToken balance is a scaled number
 * multiplied by the pool's liquidity index and rounded down, so the balance the
 * executor reads back can be a unit or two under what went in. A plan of ours
 * reverted on exactly that: `SlippageExceeded(aBasUSDC, 4987242, 4987243)`,
 * one millionth of a dollar short, losing the whole invest and its gas.
 *
 * A few units is generous enough to absorb the rounding and still small enough
 * to catch a supply that genuinely did not land.
 */
export function aaveMinOut(usdcIn: bigint): bigint {
  const rounding = usdcIn / BigInt(1_000_000); // 1 ppm, for very large supplies
  const slack = rounding > AAVE_ROUNDING_UNITS ? rounding : AAVE_ROUNDING_UNITS;
  return usdcIn > slack ? usdcIn - slack : ZERO;
}

function buildAaveLeg(chain: StaxChain, asset: Asset, usdcIn: bigint): Leg {
  const pool = chain.routers.aavePool!;
  const swapData = encodeFunctionData({
    abi: AAVE_POOL_ABI,
    functionName: "supply",
    args: [chain.usdc.address, usdcIn, chain.contracts.executor, 0],
  });
  return { router: pool, tokenOut: asset.address!, usdcIn, minOut: aaveMinOut(usdcIn), swapData };
}

/**
 * KyberSwap aggregator leg (USDC -> asset). sender = recipient = executor: the executor
 * `forceApprove`s the router for `usdcIn` and the router pulls it from msg.sender, then the
 * asset lands on the executor which forwards it. Returns null when Kyber has no route.
 * `minOut` is our own floor on top of Kyber's minReturn (both derived from `slippageBps`).
 */
async function buildKyberLeg(
  chain: StaxChain,
  asset: Asset,
  usdcIn: bigint,
  slippageBps: bigint,
  deadline: bigint,
): Promise<Leg | null> {
  const router = chain.routers.kyber!;
  const tokenOut = asset.address!;
  const executor = chain.contracts.executor;
  const route = await kyberRoute(chain, { tokenIn: chain.usdc.address, tokenOut, amountIn: usdcIn });
  if (!route) return null;
  const built = await kyberBuild(chain, {
    routeSummary: route.routeSummary,
    sender: executor,
    recipient: executor,
    slippageBps: Number(slippageBps),
    deadline: Number(deadline),
  });
  if (built.amountIn !== usdcIn) {
    throw new Error(`Kyber built a ${asset.symbol} leg for a different amount than requested.`);
  }
  const minOut = (built.amountOut * (BPS - slippageBps)) / BPS;
  if (minOut <= ZERO) return null;
  return { router, tokenOut, usdcIn, minOut, swapData: built.data };
}

type LegKind = "single" | "route" | "aave" | "kyber" | "binance";

/**
 * BSC executor leg (ADR-0005, live since the 2026-10-07 test): one Binance aggregator swap with
 * the executor as taker — Binance delivers to whoever calls its router, which is the executor,
 * and the executor forwards the measured amount to the user. `tokenOut` is the token buildLegs
 * already resolved for this entry (the issuer the plan showed, re-checked buyable — see
 * resolveBscStockToken), never re-derived from `asset.address` here. The executor whitelists
 * both issuers' tokens and the coins, so either is a valid `tokenOut`. The $6 floor, an RFQ
 * route and an unexpected router are all refused inside buildBinanceLeg (BinanceLegRefusal).
 */
async function buildBinanceExecutorLeg(
  chain: StaxChain,
  asset: Asset,
  tokenOut: `0x${string}`,
  usdcIn: bigint,
  slippageBps: bigint,
): Promise<Leg> {
  const leg = await buildBinanceLeg({
    chain,
    symbol: asset.symbol,
    tokenIn: chain.usdc.address,
    tokenOut,
    amountIn: usdcIn,
    taker: chain.contracts.executor,
    slippageBps: Number(slippageBps),
    usdValue: rawToUsd(chain, usdcIn),
  });
  return { router: leg.router, tokenOut, usdcIn, minOut: leg.minOut, swapData: leg.swapData };
}

interface LegEntry {
  asset: Asset;
  kind: LegKind;
  route?: AssetRoute;
  weightPct: number;
  /** "binance" legs: the token this leg buys, resolved before any leg is built. */
  tokenOut?: `0x${string}`;
  /** "binance" legs: the issuer the allocation entry named (what the plan screen showed). */
  planned?: { venue?: RwaPlatform; address?: string };
}

/**
 * BSC: settle every "binance" entry's `tokenOut` before a single leg is quoted. A stock leg buys
 * the issuer its allocation entry named (resolveBscStockToken: venue, then address, then the
 * catalog's best, then the asset's default), re-checked buyable against Binance's cached RWA token
 * list; a closed or paused one throws the direct path's own BinanceLegRefusal and the whole plan
 * stops here — nothing is quoted, nothing partial is returned. Crypto has no catalog row and no
 * market hours, so it keeps its own address and skips the gate (same as /api/swap-quote). The
 * market snapshot is read once, and only when there is a stock leg to resolve.
 */
async function resolveBinanceTokens(
  entries: LegEntry[],
  chain: StaxChain,
  given: BscMarket | undefined,
  nowSeconds: number,
): Promise<void> {
  const stocks = entries.filter((e) => e.kind === "binance" && e.asset.tier !== "crypto");
  if (stocks.length === 0) return;
  const market = given ?? (await loadBscMarket(nowSeconds * 1000));
  const byTicker = new Map(market.catalog.map((t) => [t.ticker, t]));
  for (const e of stocks) {
    e.tokenOut = resolveBscStockToken({
      chain,
      asset: e.asset,
      planned: e.planned ?? {},
      ticker: byTicker.get(e.asset.symbol),
      tokens: market.tokens,
      nowMs: market.nowMs,
    });
  }
}

/**
 * Split `usdcTotal` across `entries` and build every leg in parallel. A Kyber leg with no
 * route and no fallback pool is dropped; the survivors are re-split so the whole net amount
 * is still deployed (the executor would refund leftovers, but the user paid the fee on them).
 */
async function buildAll(
  chain: StaxChain,
  client: PublicClient,
  entries: LegEntry[],
  usdcTotal: bigint,
  slippageBps: bigint,
  deadline: bigint,
  notes: string[],
): Promise<Leg[]> {
  if (entries.length === 0) {
    throw new Error(
      `No investable assets in this allocation on ${chain.name}. (No validated swap route for any requested asset.)`,
    );
  }
  const split = splitByWeight(
    entries.map((e) => ({ asset: e.asset, weightPct: e.weightPct })),
    usdcTotal,
  );
  const entryBySymbol = new Map(entries.map((e) => [e.asset.symbol, e]));

  // All legs in parallel: Kyber legs are two HTTP round-trips each; pool reads fold into
  // one multicall via the client's batcher.
  const built = await Promise.all(
    split.map(async ({ asset, usdcIn }): Promise<Leg | null> => {
      const entry = entryBySymbol.get(asset.symbol)!;
      switch (entry.kind) {
        case "aave":
          return buildAaveLeg(chain, asset, usdcIn);
        case "binance":
          return buildBinanceExecutorLeg(chain, asset, entry.tokenOut!, usdcIn, slippageBps);
        case "route":
          return buildRouteLeg(chain, client, asset, entry.route!, usdcIn, slippageBps, deadline);
        case "kyber": {
          const leg = await buildKyberLeg(chain, asset, usdcIn, slippageBps, deadline);
          if (leg) return leg;
          if (asset.pool && asset.feeTier !== undefined) {
            notes.push(`${asset.symbol}: no aggregator route right now, used its direct USDC pool instead.`);
            return buildSingleHopLeg(chain, client, asset, usdcIn, slippageBps, deadline);
          }
          return null;
        }
        default:
          return buildSingleHopLeg(chain, client, asset, usdcIn, slippageBps, deadline);
      }
    }),
  );

  const dropped = split.filter((_, i) => built[i] === null).map((s) => s.asset.symbol);
  if (dropped.length === 0) return built as Leg[];

  for (const sym of dropped) {
    const e = entryBySymbol.get(sym)!;
    notes.push(`Skipped ${sym} (${e.weightPct}%): no swap route on ${chain.name} right now.`);
  }
  notes.push(`Re-split the amount across the remaining assets.`);
  return buildAll(
    chain,
    client,
    entries.filter((e) => !dropped.includes(e.asset.symbol)),
    usdcTotal,
    slippageBps,
    deadline,
    notes,
  );
}

export async function buildLegs(args: BuildLegsArgs): Promise<BuildLegsResult> {
  const { chain, allocation, usdcTotal, client, nowSeconds } = args;
  const slippageBps = BigInt(args.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
  const notes: string[] = [];

  // Keep any allocation entry we can build a validated leg for on this chain.
  const entries: LegEntry[] = [];
  for (const a of allocation.allocations) {
    const asset = assetBySymbol(chain, a.symbol);
    const route = chain.routes[a.symbol];
    if (!asset) {
      notes.push(`Skipped ${a.symbol} (${a.weightPct}%): not listed on ${chain.name}.`);
    } else if (asset.coming) {
      notes.push(`Skipped ${a.symbol} (${a.weightPct}%): coming soon on ${chain.name}, not buyable yet.`);
    } else if (asset.via === "aave_v3" && asset.address && chain.routers.aavePool) {
      entries.push({ asset, kind: "aave", weightPct: a.weightPct });
    } else if (asset.via === "binance" && asset.address && chain.routers.binance) {
      // BSC (ADR-0005): the executor path is live (bsc.contracts.ts). A chain with a Binance
      // router but no deployed executor builds direct smart-account calls instead, outside
      // `buildLegs` (bscPlan.ts), so here every such leg is dropped.
      if (chain.contracts.deployed) {
        entries.push({ asset, kind: "binance", weightPct: a.weightPct, tokenOut: asset.address, planned: { venue: a.venue, address: a.address } });
      } else {
        notes.push(`Skipped ${a.symbol} (${a.weightPct}%): the executor isn't deployed on ${chain.name} yet.`);
      }
    } else if (chain.routers.kyber && asset.address && asset.via !== "route") {
      // Aggregator chain: Kyber first, direct pool (if any) as the fallback inside buildAll.
      entries.push({ asset, kind: "kyber", weightPct: a.weightPct });
    } else if (asset.address && asset.pool && asset.feeTier !== undefined) {
      entries.push({ asset, kind: "single", weightPct: a.weightPct });
    } else if (route) {
      entries.push({ asset, kind: "route", route, weightPct: a.weightPct });
    } else {
      notes.push(`Skipped ${a.symbol} (${a.weightPct}%): no validated swap route on ${chain.name} yet.`);
    }
  }

  const droppedWeight = 100 - entries.reduce((s, e) => s + e.weightPct, 0);
  if (entries.length > 0 && Math.abs(droppedWeight) > 0.5) {
    notes.push(
      `Re-normalized weights to 100% after dropping ${droppedWeight.toFixed(1)}% of unsupported assets.`,
    );
  }

  await resolveBinanceTokens(entries, chain, args.bscMarket, nowSeconds);

  const deadline = BigInt(nowSeconds + DEADLINE_SECONDS);
  const legs = await buildAll(chain, client, entries, usdcTotal, slippageBps, deadline, notes);
  return { legs, usdcTotal, notes };
}
