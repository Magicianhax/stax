// Live USD spot pricing for every Stax asset on a given chain, read straight from
// DEX pools via a read-only public client (no third-party price API).
//
//   - Single-hop assets (stocks, cbBTC/WETH on Base): their USDC V3 pool slot0.
//   - Kyber-routed assets WITHOUT a direct pool (Base TSLA/AMZN/MSFT/MSTR): the
//     aggregator's quote for 100 USDC (`priceUsd = 100 / amountOut`), cached 30s
//     per asset so a burst of clients costs one Kyber call.
//   - Routed assets (Mantle sUSDe / mETH): chained spot across the validated route
//     hops, so the headline price reflects the real route a buy would take.
//   - Aave v3 aToken (Base aUSDC): priced 1:1 with USDC; `apy` from the Pool's
//     currentLiquidityRate (ray).
//   - Assets with a Chainlink feed (`priceFeed`) ALSO report `marketPrice` — the
//     reference market price (8 dec) — alongside the pool price a buy actually pays,
//     plus `marketPriceAt` (the feed's `updatedAt`, unix seconds) so the UI can say
//     how stale the reference is (feeds only move while the stock market is open).
//   - Coinbase B20 stocks (Base) also report `sharesPerToken` = multiplier()/1e18:
//     dividends are reinvested by growing the multiplier, so one token can be worth
//     more than one share over time (1.0 today).
//   - Anything without a pool/route: no live price (undefined), surfaced honestly.
//
// All math is integer (bigint) on raw units; we only convert to a JS number at the
// very end for display. This mirrors lib/legBuilder.ts so the price you see matches
// the price you trade at. Reads are issued in parallel — the server client's
// multicall batching folds them into one eth_call.
import "server-only";
import { zeroAddress, type PublicClient } from "viem";
import { AAVE_POOL_ABI, AGGREGATOR_V3_ABI, B20_ABI, V3_POOL_ABI } from "./abis";
import type { Asset, RouteHop, StaxChain } from "./chains/types";
import { getBinanceWeb3 } from "./server/binance";
import { kyberRoute } from "./server/kyber";
import { usdToRaw } from "./units";

const Q192 = (BigInt(2) ** BigInt(96)) ** BigInt(2);
const ZERO = BigInt(0);
const RAY = 1e27;
const SECONDS_PER_YEAR = 31_536_000;
const KYBER_PRICE_TTL_MS = 30_000;
/** Reference notional for the Kyber price probe, in whole dollars. */
const KYBER_PROBE_USD = 100;

export type PriceSource = "fluxion" | "uniswap_v3" | "agni_route" | "aave_v3" | "kyber" | "binance" | "none";

export interface AssetPrice {
  symbol: string;
  /** USD per whole token from the on-chain venue (what a buy pays), or undefined if no live source. */
  priceUsd?: number;
  /** Reference market price from the asset's Chainlink feed (8 dec), when one exists. */
  marketPrice?: number;
  /** When the feed last updated (unix seconds) — stale outside US market hours. */
  marketPriceAt?: number;
  /** Coinbase B20 stocks: shares one token represents (multiplier / 1e18; 1 today). */
  sharesPerToken?: number;
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
 * We quote a cash-in of $1000 (good precision for a 6dp -> 18dp leg, and just as good for an
 * 18dp cash asset) and divide to get a per-token price. Each hop direction is inferred from
 * the pool's token0.
 */
async function priceFromRoute(chain: StaxChain, client: PublicClient, hops: RouteHop[]): Promise<number | undefined> {
  try {
    const pools = await Promise.all(hops.map((h) => readPool(client, h.pool)));
    let amount = usdToRaw(chain, 1000);
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

// ── Kyber price cache (promise-deduped, 30s per chain+asset) ─────────────────
const kyberPriceCache = new Map<string, { at: number; value: Promise<number | undefined> }>();

/**
 * Price one whole `asset` in USD from the KyberSwap aggregator's quote for 100 USDC.
 * Best-effort: no route / upstream error ⇒ undefined (never throws). Failures are not
 * cached so the next request retries.
 */
function priceFromKyber(chain: StaxChain, asset: Asset): Promise<number | undefined> {
  if (!asset.address || !asset.decimals || !chain.routers.kyber) return Promise.resolve(undefined);
  const key = `${chain.key}:${asset.symbol}`;
  const hit = kyberPriceCache.get(key);
  if (hit && Date.now() - hit.at < KYBER_PRICE_TTL_MS) return hit.value;
  const decimals = asset.decimals;
  const probeRaw = usdToRaw(chain, KYBER_PROBE_USD);
  const value = kyberRoute(chain, { tokenIn: chain.usdc.address, tokenOut: asset.address, amountIn: probeRaw })
    .then((route) => {
      if (!route) return undefined;
      const qty = Number(route.amountOut) / Number(pow10(decimals));
      return qty > 0 ? KYBER_PROBE_USD / qty : undefined;
    })
    .catch(() => undefined)
    .then((price) => {
      if (price === undefined) kyberPriceCache.delete(key);
      return price;
    });
  kyberPriceCache.set(key, { at: Date.now(), value });
  return value;
}

/** Chainlink AggregatorV3 reference price (8 dec) → USD number + updatedAt, or undefined. */
async function marketPriceFromFeed(
  client: PublicClient,
  feed: `0x${string}`,
): Promise<{ price: number; at: number } | undefined> {
  try {
    const round = await client.readContract({ address: feed, abi: AGGREGATOR_V3_ABI, functionName: "latestRoundData" });
    const [, answer, , updatedAt] = round as readonly bigint[];
    if (answer <= ZERO) return undefined;
    return { price: Number(answer) / 1e8, at: Number(updatedAt) };
  } catch {
    return undefined;
  }
}

/** Coinbase B20 `multiplier()` (WAD) → shares per token, or undefined if the call fails. */
async function b20SharesPerToken(
  client: PublicClient,
  token: `0x${string}`,
): Promise<number | undefined> {
  try {
    const wad = await client.readContract({ address: token, abi: B20_ABI, functionName: "multiplier" });
    if ((wad as bigint) <= ZERO) return undefined;
    // 6 dp is plenty for display ("1 token = 1.02 shares") and avoids float noise. This is the
    // B20 contract's own 18-decimal `multiplier()` WAD, not the chain's cash decimals (Coinbase
    // B20 is Base-only per `isB20Stock` below, so it never runs on BSC either way) — not one of
    // the 6-decimal-cash sites this file's BSC pass needed to fix.
    return Number((wad as bigint) / BigInt(1e12)) / 1e6;
  } catch {
    return undefined;
  }
}

/** True for Coinbase-issued B20 stock tokens (Base stock tier with an address). */
function isB20Stock(chain: StaxChain, asset: Asset): asset is Asset & { address: `0x${string}` } {
  return chain.key === "base" && asset.tier === "stock" && Boolean(asset.address);
}

/**
 * BSC price for one asset from the shared RWA catalog pull (docs/BINANCE-WEB3.md §2).
 * `rwaTokens()` is its own Redis-cached, single-flighted call (Task 7), so however many BSC
 * assets `priceAll` prices concurrently, they still cost one Binance request per cache window —
 * the same budget the RWA catalog (`lib/server/rwaCatalog.ts`) reads from.
 */
async function priceFromRwaToken(asset: Asset & { address: `0x${string}` }): Promise<{ priceUsd: number; referencePrice: number } | undefined> {
  try {
    const tokens = await getBinanceWeb3().rwaTokens();
    const lower = asset.address.toLowerCase();
    const token = tokens.find((t) => t.tokenContractAddress.toLowerCase() === lower);
    return token ? { priceUsd: token.tokenPrice, referencePrice: token.referencePrice } : undefined;
  } catch {
    return undefined;
  }
}

// ── Binance aggregator quote price cache (promise-deduped, 30s per chain+asset) ──────────────
const binanceQuotePriceCache = new Map<string, { at: number; value: Promise<number | undefined> }>();
/** Reference notional for the crypto price probe, in whole dollars. */
const BINANCE_QUOTE_PROBE_USD = 100;

/**
 * Price one whole BSC crypto asset (BTCB/ETH/BNB — not an RWA token, so it has no
 * `rwa/tokens` row) from the Binance aggregator's own quote for $100 of cash, the same source
 * `buildBinanceLeg` uses to actually execute a trade — mirrors `priceFromKyber`'s use of a live
 * aggregator quote as Base's price source for assets with no direct pool. Best-effort: no
 * route / upstream error => undefined (never invents a price), and failures aren't cached so
 * the next request retries. The quote is read-only (no `taker` funds are needed to price it),
 * so a constant placeholder address stands in for one.
 */
function priceFromBinanceQuote(chain: StaxChain, asset: Asset & { address: `0x${string}` }): Promise<number | undefined> {
  const key = `${chain.key}:${asset.symbol}`;
  const hit = binanceQuotePriceCache.get(key);
  if (hit && Date.now() - hit.at < KYBER_PRICE_TTL_MS) return hit.value;
  const decimals = asset.decimals ?? 18;
  const probeRaw = usdToRaw(chain, BINANCE_QUOTE_PROBE_USD);
  const value = getBinanceWeb3()
    .quote({ fromToken: chain.usdc.address, toToken: asset.address, amount: probeRaw, taker: zeroAddress })
    .then((q) => {
      const qty = Number(q.toTokenAmount) / Number(pow10(decimals));
      return qty > 0 ? BINANCE_QUOTE_PROBE_USD / qty : undefined;
    })
    .catch(() => undefined)
    .then((price) => {
      if (price === undefined) binanceQuotePriceCache.delete(key);
      return price;
    });
  binanceQuotePriceCache.set(key, { at: Date.now(), value });
  return value;
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
  // Kicked off first so the multicall batcher folds them in with the pool reads.
  const marketPromise = asset.priceFeed ? marketPriceFromFeed(client, asset.priceFeed) : Promise.resolve(undefined);
  const sharesPromise = isB20Stock(chain, asset) ? b20SharesPerToken(client, asset.address) : Promise.resolve(undefined);

  let priceUsd: number | undefined;
  let source: PriceSource = "none";
  let apy: number | undefined;
  let rwa: { priceUsd: number; referencePrice: number } | undefined;

  if (asset.via === "aave_v3") {
    // aToken == underlying USDC, 1:1 (rebasing balance carries the yield).
    priceUsd = 1;
    source = "aave_v3";
    apy = await aaveSupplyApy(chain, client);
  } else if (asset.pool && asset.address) {
    priceUsd = await priceFromPool(chain, client, asset);
    if (priceUsd !== undefined) source = chain.routers.v3Kind === "fluxion" ? "fluxion" : "uniswap_v3";
  } else if (asset.via === "kyber" && asset.address && chain.routers.kyber && !asset.coming) {
    priceUsd = await priceFromKyber(chain, asset);
    if (priceUsd !== undefined) source = "kyber";
  } else if (chain.routes[asset.symbol]) {
    priceUsd = await priceFromRoute(chain, client, chain.routes[asset.symbol].hops);
    if (priceUsd !== undefined) source = "agni_route";
  } else if (asset.via === "binance" && asset.address && asset.tier === "crypto" && !asset.coming) {
    // Crypto isn't an RWA token — no reference share price, no `rwa/tokens` row — so it's priced
    // from the same aggregator quote a trade would actually get, not the RWA Data API.
    priceUsd = await priceFromBinanceQuote(chain, asset as Asset & { address: `0x${string}` });
    if (priceUsd !== undefined) source = "binance";
  } else if (asset.via === "binance" && asset.address && !asset.coming) {
    rwa = await priceFromRwaToken(asset as Asset & { address: `0x${string}` });
    if (rwa !== undefined) {
      priceUsd = rwa.priceUsd;
      source = "binance";
    }
  }

  const [market, sharesPerToken] = await Promise.all([marketPromise, sharesPromise]);
  const out: AssetPrice = { symbol: asset.symbol, priceUsd, source };
  if (market !== undefined) {
    out.marketPrice = market.price;
    out.marketPriceAt = market.at;
  } else if (rwa !== undefined) {
    // No Chainlink feed on BSC; the RWA Data API's own referencePrice is the reference here.
    out.marketPrice = rwa.referencePrice;
    out.marketPriceAt = Math.floor(Date.now() / 1000);
  }
  if (sharesPerToken !== undefined) out.sharesPerToken = sharesPerToken;
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
