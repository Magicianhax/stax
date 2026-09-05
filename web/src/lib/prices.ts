// Live USD spot pricing for every Stax asset on a given chain, read straight from
// DEX pools via a read-only public client (no third-party price API).
//
//   - Single-hop assets (stocks, cbBTC/WETH on Base): their USDC V3 pool slot0.
//   - Routed assets (Mantle sUSDe / mETH): chained spot across the validated route
//     hops, so the headline price reflects the real route a buy would take.
//   - Aave v3 aToken (Base aUSDC): priced 1:1 with USDC; `apy` from the Pool's
//     currentLiquidityRate (ray).
//   - Assets with a Chainlink feed (`priceFeed`) ALSO report `marketPrice` — the
//     reference market price (8 dec) — alongside the pool price a buy actually pays.
//   - Anything without a pool/route: no live price (undefined), surfaced honestly.
//
// All math is integer (bigint) on raw units; we only convert to a JS number at the
// very end for display. This mirrors lib/legBuilder.ts so the price you see matches
// the price you trade at. Reads are issued in parallel — the server client's
// multicall batching folds them into one eth_call.
import type { PublicClient } from "viem";
import { AAVE_POOL_ABI, AGGREGATOR_V3_ABI, V3_POOL_ABI } from "./abis";
import type { Asset, RouteHop, StaxChain } from "./chains/types";

const Q192 = (BigInt(2) ** BigInt(96)) ** BigInt(2);
const ZERO = BigInt(0);
const RAY = 1e27;
const SECONDS_PER_YEAR = 31_536_000;

export type PriceSource = "fluxion" | "uniswap_v3" | "agni_route" | "aave_v3" | "none";

export interface AssetPrice {
  symbol: string;
  /** USD per whole token from the on-chain venue (what a buy pays), or undefined if no live source. */
  priceUsd?: number;
  /** Reference market price from the asset's Chainlink feed (8 dec), when one exists. */
  marketPrice?: number;
  /** Supply APY in percent for yield assets (Aave v3), when applicable. */
  apy?: number;
  /** Where the price came from (for honesty in the UI / debugging). */
  source: PriceSource;
}

function pow10(n: number): bigint {
  return BigInt(10) ** BigInt(n);
}

/**
 * Spot output (raw units of `tokenOut`) for `amountInRaw` of `tokenIn` through one
 * V3 pool, given its sqrtPriceX96 and which token is token0.
 *   price(token1/token0) = (sqrtP/2^96)^2.
 */
function hopOut(sqrtPriceX96: bigint, amountInRaw: bigint, tokenInIsToken0: boolean): bigint {
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

/** Price one whole `asset` in USD from its single-hop USDC pool. */
async function priceFromPool(
  chain: StaxChain,
  client: PublicClient,
  asset: Asset,
): Promise<number | undefined> {
  if (!asset.pool || !asset.decimals) return undefined;
  try {
    const { sqrtPriceX96, token0 } = await readPool(client, asset.pool);
    const usdcIsToken0 = token0 === chain.usdc.address.toLowerCase();
    // USDC out (6dp) for selling 1 whole token.
    const oneToken = pow10(asset.decimals);
    const usdcOutRaw = hopOut(sqrtPriceX96, oneToken, !usdcIsToken0);
    return Number(usdcOutRaw) / 10 ** chain.usdc.decimals;
  } catch {
    return undefined;
  }
}

/**
 * Price one whole `asset` in USD by chaining the spot price across its route hops.
 * We quote a USDC-in of $1000 (good precision for 6dp -> 18dp legs) and divide to
 * get a per-token price. Each hop direction is inferred from the pool's token0.
 */
async function priceFromRoute(client: PublicClient, hops: RouteHop[]): Promise<number | undefined> {
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

/** Chainlink AggregatorV3 reference price (8 dec) → USD number, or undefined. */
async function marketPriceFromFeed(
  client: PublicClient,
  feed: `0x${string}`,
): Promise<number | undefined> {
  try {
    const round = await client.readContract({ address: feed, abi: AGGREGATOR_V3_ABI, functionName: "latestRoundData" });
    const answer = (round as readonly bigint[])[1];
    if (answer <= ZERO) return undefined;
    return Number(answer) / 1e8;
  } catch {
    return undefined;
  }
}

/** Aave v3 supply APY (percent) for USDC on this chain, from currentLiquidityRate (ray). */
async function aaveSupplyApy(chain: StaxChain, client: PublicClient): Promise<number | undefined> {
  if (!chain.routers.aavePool) return undefined;
  try {
    const data = await client.readContract({
      address: chain.routers.aavePool,
      abi: AAVE_POOL_ABI,
      functionName: "getReserveData",
      args: [chain.usdc.address],
    });
    const rateRay = Number((data as { currentLiquidityRate: bigint }).currentLiquidityRate);
    const apr = rateRay / RAY;
    // Aave compounds per second; this is the APY the Aave UI shows.
    const apy = (1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1;
    return Math.round(apy * 10000) / 100;
  } catch {
    return undefined;
  }
}

/** Price a single asset on `chain`. Best-effort; undefined price when no live source. */
export async function priceAsset(
  chain: StaxChain,
  client: PublicClient,
  asset: Asset,
): Promise<AssetPrice> {
  const marketPromise = asset.priceFeed ? marketPriceFromFeed(client, asset.priceFeed) : Promise.resolve(undefined);

  let priceUsd: number | undefined;
  let source: PriceSource = "none";
  let apy: number | undefined;

  if (asset.via === "aave_v3") {
    // aToken == underlying USDC, 1:1 (rebasing balance carries the yield).
    priceUsd = 1;
    source = "aave_v3";
    apy = await aaveSupplyApy(chain, client);
  } else if (asset.pool && asset.address) {
    priceUsd = await priceFromPool(chain, client, asset);
    if (priceUsd !== undefined) source = chain.routers.v3Kind === "fluxion" ? "fluxion" : "uniswap_v3";
  } else if (chain.routes[asset.symbol]) {
    priceUsd = await priceFromRoute(client, chain.routes[asset.symbol].hops);
    if (priceUsd !== undefined) source = "agni_route";
  }

  const marketPrice = await marketPromise;
  const out: AssetPrice = { symbol: asset.symbol, priceUsd, source };
  if (marketPrice !== undefined) out.marketPrice = marketPrice;
  if (apy !== undefined) out.apy = apy;
  return out;
}

/** Price every asset on `chain` (or a provided subset). Returns a symbol->price map. */
export async function priceAll(
  chain: StaxChain,
  client: PublicClient,
  assets: Asset[] = chain.assets.all,
): Promise<Record<string, AssetPrice>> {
  const results = await Promise.all(assets.map((a) => priceAsset(chain, client, a)));
  const map: Record<string, AssetPrice> = {};
  for (const r of results) map[r.symbol] = r;
  return map;
}
