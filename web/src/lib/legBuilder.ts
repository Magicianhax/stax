// Builds StaxExecutor `Leg[]` from an AI Allocation.
//
// MVP scope: only 'stock'-tier assets route through Fluxion (single-hop USDC -> xStock,
// fee tier 3000). If the allocation contains 'safe'/'crypto' tiers we cannot yet build a
// correct Fluxion swap for, we DROP them and re-normalize the stock weights to 100%,
// surfacing that in `notes` so the caller/UI can be honest with the user.
//
// Quoting: there is no standalone Quoter deployed alongside the Fluxion router, so we read
// the V3 pool's slot0 sqrtPriceX96 and compute the spot expected output, then apply a
// slippage buffer to derive minOut. This is a spot estimate (no tick-crossing/price-impact
// modeling); the on-chain `amountOutMinimum` is what actually protects the user.
import { concatHex, encodeFunctionData, numberToHex, type PublicClient } from "viem";
import { AGNI_ROUTER_ABI, FLUXION_ROUTER_ABI, V3_POOL_ABI } from "./abis";
import { priceLimitSqrtX96 } from "./swapGuards";
import {
  USDC,
  FLUXION_ROUTER,
  STOCKS,
  ASSET_ROUTES,
  type Asset,
  type AssetRoute,
  type RouteHop,
} from "./mantle";
import type { Allocation } from "./allocation-schema";

const STAX_EXECUTOR = (process.env.NEXT_PUBLIC_STAX_EXECUTOR ||
  "0x3411196abdc3dbe59c5e2878c44d1931a975af12") as `0x${string}`;

const ZERO = BigInt(0);
const Q96 = BigInt(2) ** BigInt(96);
const Q192 = Q96 * Q96;
const BPS = BigInt(10000);
const DEFAULT_SLIPPAGE_BPS = 100; // 1% buffer on the spot quote -> minOut
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

interface BuildLegsArgs {
  allocation: Allocation;
  usdcTotal: bigint; // total USDC in 6dp raw units
  client: PublicClient;
  nowSeconds: number; // request-time clock, passed in (never read at module scope)
  slippageBps?: number;
}

const STOCK_BY_SYMBOL = new Map(STOCKS.map((s) => [s.symbol, s]));

/**
 * Spot expected token-out for a given USDC-in, from the pool sqrtPriceX96.
 * price (token1 per token0) = (sqrtP / 2^96)^2, in raw-unit terms.
 * We branch on token ordering so this works regardless of which side USDC is.
 */
function expectedOutFromSqrt(
  sqrtPriceX96: bigint,
  amountInUsdcRaw: bigint,
  usdcIsToken0: boolean,
): bigint {
  // To preserve precision with integer math, scale numerator before dividing.
  // priceX192 = sqrtP^2  (represents token1/token0 * 2^192)
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  if (usdcIsToken0) {
    // out(token1) = in(token0) * price = in * priceX192 / 2^192
    return (amountInUsdcRaw * priceX192) / Q192;
  }
  // USDC is token1 => out(token0) = in(token1) / price = in * 2^192 / priceX192
  if (priceX192 === ZERO) return ZERO;
  return (amountInUsdcRaw * Q192) / priceX192;
}

/**
 * Encode an Agni/Uniswap-V3 `exactInput` path: abi.encodePacked of
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

/**
 * Chain the spot price across a route's hops to get expected final-token out for a
 * USDC-in. Each hop reads its pool's slot0 + token0 to branch on token ordering.
 * Spot estimate only — the on-chain amountOutMinimum is the real protection.
 */
async function expectedOutAlongRoute(
  client: PublicClient,
  route: AssetRoute,
  usdcInRaw: bigint,
): Promise<bigint> {
  const states = await Promise.all(
    route.hops.map((h) =>
      Promise.all([
        client.readContract({ address: h.pool, abi: V3_POOL_ABI, functionName: "slot0" }),
        client.readContract({ address: h.pool, abi: V3_POOL_ABI, functionName: "token0" }),
      ]),
    ),
  );
  let amount = usdcInRaw;
  for (let i = 0; i < route.hops.length; i++) {
    const h = route.hops[i];
    const sqrtPriceX96 = (states[i][0] as readonly bigint[])[0];
    const tokenInIsToken0 = (states[i][1] as string).toLowerCase() === h.tokenIn.toLowerCase();
    amount = expectedOutFromSqrt(sqrtPriceX96, amount, tokenInIsToken0);
    if (amount === ZERO) return ZERO;
  }
  return amount;
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

/** Build a single-hop Fluxion leg (stock tier, USDC -> xStock, recipient = executor). */
async function buildStockLeg(
  client: PublicClient,
  asset: Asset,
  usdcIn: bigint,
  slippageBps: bigint,
  deadline: bigint,
): Promise<Leg> {
  const pool = asset.pool!;
  const tokenOut = asset.address!;
  const [slot0, token0] = await Promise.all([
    client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "token0" }),
  ]);
  const sqrtPriceX96 = (slot0 as readonly bigint[])[0];
  const usdcIsToken0 = (token0 as string).toLowerCase() === USDC.address.toLowerCase();
  const expectedOut = expectedOutFromSqrt(sqrtPriceX96, usdcIn, usdcIsToken0);
  const minOut = (expectedOut * (BPS - slippageBps)) / BPS;
  // USDC is tokenIn, so zeroForOne == (USDC is token0). Wide price-impact ceiling
  // on top of the precise minOut floor (see swapGuards.ts).
  const sqrtLimit = priceLimitSqrtX96(sqrtPriceX96, usdcIsToken0);

  const swapData = encodeFunctionData({
    abi: FLUXION_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: USDC.address as `0x${string}`,
        tokenOut,
        fee: asset.feeTier ?? 3000,
        recipient: STAX_EXECUTOR, // executor receives, then forwards to caller
        deadline,
        amountIn: usdcIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: sqrtLimit,
      },
    ],
  });
  return { router: FLUXION_ROUTER as `0x${string}`, tokenOut, usdcIn, minOut, swapData };
}

/** Build a multi-hop Agni V3 `exactInput` leg (sUSDe/mETH, recipient = executor). */
async function buildRouteLeg(
  client: PublicClient,
  asset: Asset,
  route: AssetRoute,
  usdcIn: bigint,
  slippageBps: bigint,
  deadline: bigint,
): Promise<Leg> {
  const tokenOut = asset.address!;
  const expectedOut = await expectedOutAlongRoute(client, route, usdcIn);
  const minOut = (expectedOut * (BPS - slippageBps)) / BPS;
  const path = encodeV3Path(route.hops);

  const swapData = encodeFunctionData({
    abi: AGNI_ROUTER_ABI,
    functionName: "exactInput",
    args: [
      {
        path,
        recipient: STAX_EXECUTOR, // executor receives the final token, then forwards
        deadline,
        amountIn: usdcIn,
        amountOutMinimum: minOut,
      },
    ],
  });
  return { router: route.router, tokenOut, usdcIn, minOut, swapData };
}

export async function buildLegs(args: BuildLegsArgs): Promise<BuildLegsResult> {
  const { allocation, usdcTotal, client, nowSeconds } = args;
  const slippageBps = BigInt(args.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
  const notes: string[] = [];

  // Keep any allocation entry we can build a validated leg for: a stock-tier
  // xStock (Fluxion single-hop) OR a routed asset (sUSDe/mETH via Agni multi-hop).
  const entries: { asset: Asset; route?: AssetRoute; weightPct: number }[] = [];
  for (const a of allocation.allocations) {
    const stock = STOCK_BY_SYMBOL.get(a.symbol);
    const route = ASSET_ROUTES[a.symbol];
    if (stock && stock.address && stock.pool) {
      entries.push({ asset: stock, weightPct: a.weightPct });
    } else if (route) {
      // Reconstruct a minimal Asset for the routed token (address from the route's final hop).
      const tokenOut = route.hops[route.hops.length - 1].tokenOut;
      entries.push({
        asset: { symbol: a.symbol, name: a.symbol, tier: "crypto", address: tokenOut, decimals: route.hops[route.hops.length - 1].tokenOutDecimals, via: "agni" },
        route,
        weightPct: a.weightPct,
      });
    } else {
      notes.push(
        `Skipped ${a.symbol} (${a.weightPct}%): no validated swap route to that asset yet.`,
      );
    }
  }

  if (entries.length === 0) {
    throw new Error(
      "No investable assets in this allocation. (No validated swap route for any requested asset.)",
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
  const routeBySymbol = new Map(entries.map((e) => [e.asset.symbol, e.route]));
  const deadline = BigInt(nowSeconds + DEADLINE_SECONDS);

  const legs: Leg[] = [];
  for (const { asset, usdcIn } of split) {
    const route = routeBySymbol.get(asset.symbol);
    const leg = route
      ? await buildRouteLeg(client, asset, route, usdcIn, slippageBps, deadline)
      : await buildStockLeg(client, asset, usdcIn, slippageBps, deadline);
    legs.push(leg);
  }

  return { legs, usdcTotal, notes };
}

export { STAX_EXECUTOR };
