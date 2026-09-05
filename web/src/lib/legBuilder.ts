// Builds StaxExecutor `Leg[]` from an AI Allocation on a given StaxChain.
//
// Leg kinds (see docs/MULTICHAIN.md):
//   - single-hop V3   asset has `pool` + `feeTier` → `chain.routers.v3`
//                     (Fluxion `exactInputSingle` WITH deadline on Mantle,
//                      Uniswap SwapRouter02 `exactInputSingle` WITHOUT deadline on Base)
//   - multi-hop V3    `chain.routes[symbol]` → `exactInput(path)` on the route's router
//                     (Agni on Mantle, Router02 when route.kind === "uniswap_v3")
//   - Aave v3 supply  asset.via === "aave_v3" → Pool.supply(USDC, amt, executor, 0) → aToken
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
import type { Asset, AssetRoute, RouteHop, StaxChain } from "./chains/types";
import type { Allocation } from "./allocation-schema";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const Q96 = BigInt(2) ** BigInt(96);
const Q192 = Q96 * Q96;
const BPS = BigInt(10000);
const DEFAULT_SLIPPAGE_BPS = 100; // 1% buffer on the quote -> minOut
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

/** Split usdcTotal across symbols by weight; last leg absorbs rounding dust. */
function splitByWeight(
  entries: { asset: Asset; weightPct: number }[],
  usdcTotal: bigint,
): { asset: Asset; usdcIn: bigint }[] {
  const totalWeight = entries.reduce((s, e) => s + e.weightPct, 0);
  if (totalWeight <= 0) return [];
  let allocated = ZERO;
  const out = entries.map((e, i) => {
    let usdcIn: bigint;
    if (i === entries.length - 1) {
      usdcIn = usdcTotal - allocated; // remainder -> no dust left behind
    } else {
      // basis-points weight to avoid float drift
      const bps = BigInt(Math.round((e.weightPct / totalWeight) * 10000));
      usdcIn = (usdcTotal * bps) / BPS;
      allocated += usdcIn;
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

/** Aave v3 supply leg: USDC -> aToken 1:1 (recipient = executor, which forwards the aToken). */
function buildAaveLeg(chain: StaxChain, asset: Asset, usdcIn: bigint): Leg {
  const pool = chain.routers.aavePool!;
  const swapData = encodeFunctionData({
    abi: AAVE_POOL_ABI,
    functionName: "supply",
    args: [chain.usdc.address, usdcIn, chain.contracts.executor, 0],
  });
  return { router: pool, tokenOut: asset.address!, usdcIn, minOut: usdcIn - ONE, swapData };
}

type LegKind = "single" | "route" | "aave";

export async function buildLegs(args: BuildLegsArgs): Promise<BuildLegsResult> {
  const { chain, allocation, usdcTotal, client, nowSeconds } = args;
  const slippageBps = BigInt(args.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
  const notes: string[] = [];

  // Keep any allocation entry we can build a validated leg for on this chain.
  const entries: { asset: Asset; kind: LegKind; route?: AssetRoute; weightPct: number }[] = [];
  for (const a of allocation.allocations) {
    const asset = assetBySymbol(chain, a.symbol);
    const route = chain.routes[a.symbol];
    if (!asset) {
      notes.push(`Skipped ${a.symbol} (${a.weightPct}%): not listed on ${chain.name}.`);
    } else if (asset.coming) {
      notes.push(`Skipped ${a.symbol} (${a.weightPct}%): coming soon on ${chain.name}, not buyable yet.`);
    } else if (asset.address && asset.pool && asset.feeTier !== undefined) {
      entries.push({ asset, kind: "single", weightPct: a.weightPct });
    } else if (asset.via === "aave_v3" && asset.address && chain.routers.aavePool) {
      entries.push({ asset, kind: "aave", weightPct: a.weightPct });
    } else if (route) {
      entries.push({ asset, kind: "route", route, weightPct: a.weightPct });
    } else {
      notes.push(`Skipped ${a.symbol} (${a.weightPct}%): no validated swap route on ${chain.name} yet.`);
    }
  }

  if (entries.length === 0) {
    throw new Error(
      `No investable assets in this allocation on ${chain.name}. (No validated swap route for any requested asset.)`,
    );
  }

  const droppedWeight = 100 - entries.reduce((s, e) => s + e.weightPct, 0);
  if (Math.abs(droppedWeight) > 0.5) {
    notes.push(
      `Re-normalized weights to 100% after dropping ${droppedWeight.toFixed(1)}% of unsupported assets.`,
    );
  }

  const split = splitByWeight(
    entries.map((e) => ({ asset: e.asset, weightPct: e.weightPct })),
    usdcTotal,
  );
  const entryBySymbol = new Map(entries.map((e) => [e.asset.symbol, e]));
  const deadline = BigInt(nowSeconds + DEADLINE_SECONDS);

  const legs: Leg[] = [];
  for (const { asset, usdcIn } of split) {
    const entry = entryBySymbol.get(asset.symbol)!;
    let leg: Leg;
    if (entry.kind === "aave") {
      leg = buildAaveLeg(chain, asset, usdcIn);
    } else if (entry.kind === "route") {
      leg = await buildRouteLeg(chain, client, asset, entry.route!, usdcIn, slippageBps, deadline);
    } else {
      leg = await buildSingleHopLeg(chain, client, asset, usdcIn, slippageBps, deadline);
    }
    legs.push(leg);
  }

  return { legs, usdcTotal, notes };
}
