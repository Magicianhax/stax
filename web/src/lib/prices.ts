// Live USD spot pricing for every Stax asset, read straight from DEX pools via
// the shared read-only public client (no third-party price API).
//
//   - Stocks: their Fluxion USDC pool slot0 (sqrtPriceX96).
//   - sUSDe / mETH: chained spot across their validated Agni V3 route hops
//     (USDC -> intermediate -> asset), so the headline price reflects the real
//     route a buy/invest would take.
//   - FBTC (and anything without a pool/route): no live price (returns undefined),
//     surfaced honestly by callers rather than faked.
//
// All math is integer (bigint) on raw units; we only convert to a JS number at the
// very end for display. This mirrors lib/legBuilder.ts + hooks/useQuote.ts so the
// price you see matches the price you trade at.
import type { PublicClient } from "viem";
import { V3_POOL_ABI } from "./abis";
import {
  USDC,
  STOCKS,
  ASSET_ROUTES,
  ALL_ASSETS,
  type Asset,
  type RouteHop,
} from "./mantle";

const Q192 = (BigInt(2) ** BigInt(96)) ** BigInt(2);
const ZERO = BigInt(0);

export interface AssetPrice {
  symbol: string;
  /** USD per whole token, or undefined if the asset has no live source. */
  priceUsd?: number;
  /** Where the price came from (for honesty in the UI / debugging). */
  source: "fluxion" | "agni_route" | "none";
}

/** raw-unit price of token1-per-token0 implied by a V3 sqrtPriceX96, as a bigint ratio numerator/denominator handled by callers. */
function pow10(n: number): bigint {
  return BigInt(10) ** BigInt(n);
}

/**
 * Spot output (raw units of `tokenOut`) for `amountInRaw` of `tokenIn` through one
 * V3 pool, given its sqrtPriceX96 and which token is token0.
 *   price(token1/token0) = (sqrtP/2^96)^2.
 */
function hopOut(
  sqrtPriceX96: bigint,
  amountInRaw: bigint,
  tokenInIsToken0: boolean,
): bigint {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  if (tokenInIsToken0) {
    // out(token1) = in(token0) * price
    return (amountInRaw * priceX192) / Q192;
  }
  // out(token0) = in(token1) / price
  if (priceX192 === ZERO) return ZERO;
  return (amountInRaw * Q192) / priceX192;
}

/** Read a pool's slot0 + token0 once. */
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

/** Price one whole `asset` in USD from its Fluxion USDC pool (stock tier). */
async function priceFromFluxion(client: PublicClient, asset: Asset): Promise<number | undefined> {
  if (!asset.pool || !asset.decimals) return undefined;
  try {
    const { sqrtPriceX96, token0 } = await readPool(client, asset.pool);
    const usdcIsToken0 = token0 === USDC.address.toLowerCase();
    // USDC out (6dp) for selling 1 whole token.
    const oneToken = pow10(asset.decimals);
    const usdcOutRaw = hopOut(sqrtPriceX96, oneToken, !usdcIsToken0);
    return Number(usdcOutRaw) / 1e6;
  } catch {
    return undefined;
  }
}

/**
 * Price one whole `asset` in USD by chaining the spot price across its Agni route
 * hops. We quote a USDC-in of $1000 (good precision for 6dp -> 18dp legs) and divide
 * to get a per-token price. Each hop direction is inferred from the pool's token0.
 */
async function priceFromRoute(
  client: PublicClient,
  hops: RouteHop[],
): Promise<number | undefined> {
  try {
    const pools = await Promise.all(hops.map((h) => readPool(client, h.pool)));
    // Reference notional: $1000 in USDC (6dp).
    const usdcInRaw = BigInt(1000) * pow10(6);
    let amount = usdcInRaw;
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i];
      const tokenInIsToken0 = pools[i].token0 === h.tokenIn.toLowerCase();
      amount = hopOut(pools[i].sqrtPriceX96, amount, tokenInIsToken0);
      if (amount === ZERO) return undefined;
    }
    const finalDecimals = hops[hops.length - 1].tokenOutDecimals;
    const finalQty = Number(amount) / Number(pow10(finalDecimals));
    if (finalQty <= 0) return undefined;
    return 1000 / finalQty; // USD per whole token
  } catch {
    return undefined;
  }
}

/** Price a single asset by symbol. Best-effort; undefined price when no live source. */
export async function priceAsset(client: PublicClient, asset: Asset): Promise<AssetPrice> {
  if (asset.pool && STOCKS.some((s) => s.symbol === asset.symbol)) {
    const priceUsd = await priceFromFluxion(client, asset);
    return { symbol: asset.symbol, priceUsd, source: priceUsd !== undefined ? "fluxion" : "none" };
  }
  const route = ASSET_ROUTES[asset.symbol];
  if (route) {
    const priceUsd = await priceFromRoute(client, route.hops);
    return { symbol: asset.symbol, priceUsd, source: priceUsd !== undefined ? "agni_route" : "none" };
  }
  return { symbol: asset.symbol, priceUsd: undefined, source: "none" };
}

/** Price every asset in the universe (or a provided subset). Returns a symbol->price map. */
export async function priceAll(
  client: PublicClient,
  assets: Asset[] = ALL_ASSETS,
): Promise<Record<string, AssetPrice>> {
  const results = await Promise.all(assets.map((a) => priceAsset(client, a)));
  const map: Record<string, AssetPrice> = {};
  for (const r of results) map[r.symbol] = r;
  return map;
}
