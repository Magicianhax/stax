"use client";

// Client-side swap routing + quoting helpers shared by useQuote and useSwap.
// Chain-agnostic: every function takes the StaxChain it should read from.
//
//   encodeV3Path(hops)                  -> packed path for exactInput / quoteExactInput
//   quoteSingleHop(chain, ...)          -> expected out for a single V3 pool hop
//   quoteAlongRoute(chain, hops, in)    -> expected out across a validated multi-hop route
//   singleHopSqrtLimit(chain, pool, in) -> price-impact ceiling for exactInputSingle
//
// Quoting prefers the Uniswap QuoterV2 when the chain has one (Base) — it
// simulates the swap so thin pools report their real price impact. Chains
// without a quoter (Mantle) and any quoter failure fall back to the pool's
// slot0 spot estimate, mirroring the server leg builder's math.
import { concatHex, numberToHex } from "viem";
import { UNISWAP_QUOTER_V2_ABI, V3_POOL_ABI } from "@/lib/abis";
import type { RouteHop, StaxChain } from "@/lib/chains";
import { getPublicClient } from "@/lib/wagmi";
import { priceLimitSqrtX96 } from "@/lib/swapGuards";

const Q192 = (BigInt(2) ** BigInt(96)) ** BigInt(2);

/** Encode a Uniswap/Agni V3 `exactInput` path: token + fee(3b) + token + ... */
export function encodeV3Path(hops: RouteHop[]): `0x${string}` {
  const parts: `0x${string}`[] = [hops[0].tokenIn];
  for (const h of hops) {
    parts.push(numberToHex(h.fee, { size: 3 }));
    parts.push(h.tokenOut);
  }
  return concatHex(parts);
}

/** Spot estimate from sqrtPriceX96: amountOut for amountIn when tokenIn is token0 (or not). */
function spotOut(sqrtPriceX96: bigint, amountInRaw: bigint, tokenInIsToken0: boolean): bigint {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  if (tokenInIsToken0) return (amountInRaw * priceX192) / Q192;
  if (priceX192 === BigInt(0)) return BigInt(0);
  return (amountInRaw * Q192) / priceX192;
}

async function poolState(chain: StaxChain, pool: `0x${string}`) {
  const client = getPublicClient(chain);
  const [slot0, token0] = await Promise.all([
    client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "token0" }),
  ]);
  return { sqrtPriceX96: (slot0 as readonly bigint[])[0], token0: (token0 as string).toLowerCase() };
}

export interface SingleHop {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  pool: `0x${string}`;
}

/** Expected output of one V3 hop (direction-agnostic; works for buys and sells). */
export async function quoteSingleHop(chain: StaxChain, hop: SingleHop, amountInRaw: bigint): Promise<bigint> {
  if (amountInRaw <= BigInt(0)) return BigInt(0);
  const quoter = chain.routers.quoterV2;
  if (quoter) {
    try {
      const { result } = await getPublicClient(chain).simulateContract({
        address: quoter,
        abi: UNISWAP_QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: hop.tokenIn, tokenOut: hop.tokenOut, amountIn: amountInRaw, fee: hop.fee, sqrtPriceLimitX96: BigInt(0) }],
      });
      return result[0];
    } catch {
      /* thin/uninitialised pool or RPC hiccup — fall through to the spot estimate */
    }
  }
  const { sqrtPriceX96, token0 } = await poolState(chain, hop.pool);
  return spotOut(sqrtPriceX96, amountInRaw, token0 === hop.tokenIn.toLowerCase());
}

/**
 * Expected final-token out across a multi-hop route. Direction-agnostic: pass
 * `reverseRoute(hops)` for sells. Uses the quoter on Uniswap-kind routes when
 * available, else chains each hop's spot price.
 */
export async function quoteAlongRoute(chain: StaxChain, hops: RouteHop[], amountInRaw: bigint): Promise<bigint> {
  if (amountInRaw <= BigInt(0) || hops.length === 0) return BigInt(0);
  if (chain.routers.quoterV2) {
    try {
      const { result } = await getPublicClient(chain).simulateContract({
        address: chain.routers.quoterV2,
        abi: UNISWAP_QUOTER_V2_ABI,
        functionName: "quoteExactInput",
        args: [encodeV3Path(hops), amountInRaw],
      });
      return result[0];
    } catch {
      /* fall through to spot */
    }
  }
  const states = await Promise.all(hops.map((h) => poolState(chain, h.pool)));
  let amount = amountInRaw;
  for (let i = 0; i < hops.length; i++) {
    amount = spotOut(states[i].sqrtPriceX96, amount, states[i].token0 === hops[i].tokenIn.toLowerCase());
    if (amount === BigInt(0)) return BigInt(0);
  }
  return amount;
}

/**
 * Best-effort price-impact ceiling for a single-hop exactInputSingle. Reads the
 * pool's current price; on any failure returns 0n (no limit), so this can never
 * make a swap worse than before. amountOutMinimum stays the precise floor
 * (see swapGuards.ts).
 */
export async function singleHopSqrtLimit(chain: StaxChain, pool: `0x${string}`, tokenIn: `0x${string}`): Promise<bigint> {
  try {
    const { sqrtPriceX96, token0 } = await poolState(chain, pool);
    return priceLimitSqrtX96(sqrtPriceX96, token0 === tokenIn.toLowerCase());
  } catch {
    return BigInt(0);
  }
}
