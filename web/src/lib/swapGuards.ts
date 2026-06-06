// Price-impact circuit breaker for Uniswap/Agni/Fluxion V3 `exactInputSingle`.
//
// `amountOutMinimum` is the PRECISE floor that protects the user's output. This
// adds a second, pool-level guard: a `sqrtPriceLimitX96` that caps how far THIS
// swap may push the pool price. It is intentionally WIDE (looser than the minOut
// slippage), so under normal conditions minOut always binds first and behavior is
// unchanged — the price limit only ever bites on catastrophic manipulation that
// minOut would already revert. Net effect: defense in depth, zero regression.

// Uniswap V3 tick price bounds.
const MIN_SQRT_RATIO = BigInt("4295128739");
const MAX_SQRT_RATIO = BigInt("1461446703485210103287273052203988822378723970342");
const ONE = BigInt(1);

/** Default ceiling on a single swap's pool-price move (10%). */
export const MAX_PRICE_IMPACT_BPS = 1000;

/**
 * Compute a sqrtPriceLimitX96 bound for an exactInputSingle swap.
 * @param currentSqrtPriceX96 pool's current slot0.sqrtPriceX96
 * @param zeroForOne true when tokenIn == pool.token0 (i.e. tokenIn < tokenOut by address)
 * @param maxImpactBps how far the price may move before the swap stops
 */
export function priceLimitSqrtX96(
  currentSqrtPriceX96: bigint,
  zeroForOne: boolean,
  maxImpactBps: number = MAX_PRICE_IMPACT_BPS,
): bigint {
  // zeroForOne pushes price DOWN, so the limit sits below current (factor < 1);
  // oneForZero pushes price UP, so the limit sits above current (factor > 1).
  const ratio = zeroForOne ? 1 - maxImpactBps / 10000 : 1 + maxImpactBps / 10000;
  // Wide bound — Number(bigint) keeps ~16 significant figures, ample for a 10% gate.
  let limit = BigInt(Math.floor(Number(currentSqrtPriceX96) * Math.sqrt(ratio)));
  if (zeroForOne) {
    if (limit <= MIN_SQRT_RATIO) limit = MIN_SQRT_RATIO + ONE;
    if (limit >= currentSqrtPriceX96) limit = currentSqrtPriceX96 - ONE;
  } else {
    if (limit >= MAX_SQRT_RATIO) limit = MAX_SQRT_RATIO - ONE;
    if (limit <= currentSqrtPriceX96) limit = currentSqrtPriceX96 + ONE;
  }
  return limit;
}
