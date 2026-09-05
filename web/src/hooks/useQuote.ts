"use client";

// Client-side quotes for the Pro manual buy/sell panel, on the active chain.
//
//   useQuote(asset, amountUsd)     -> USDC in  -> asset out
//   useSellQuote(asset, tokenRaw)  -> asset in -> USDC out
//
// Base: Uniswap QuoterV2 simulation (real price impact), slot0 spot fallback.
// Mantle: Fluxion pool spot for stocks, chained Agni hops for routed assets.
// Aave "safe dollars": 1:1 (aBasUSDC and USDC are both 6 dec).
// minOut is derived by the caller from a slippage buffer; the on-chain
// amountOutMinimum is the real protection.
import { useQuery } from "@tanstack/react-query";
import { isRoutable, reverseRoute, type Asset } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { fromUnits } from "@/lib/format";
import { quoteAlongRoute, quoteSingleHop } from "@/lib/swapRouting";

export interface Quote {
  amountInRaw: bigint; // USDC, 6dp
  expectedOutRaw: bigint; // tokenOut, asset.decimals
  expectedOutQty: number;
  pricePerToken: number; // USDC per whole token
}

/**
 * Quote `amountUsd` of USDC into `asset`. Debounced via react-query keying on the
 * rounded amount; keyed by chain so a network switch re-quotes. Returns no data
 * while disabled/loading.
 */
export function useQuote(asset: Asset | null, amountUsd: number) {
  const chain = useChain();
  const enabled = Boolean(asset && asset.decimals && amountUsd > 0 && isRoutable(chain, asset.symbol));
  return useQuery({
    queryKey: ["quote", chain.key, asset?.symbol, Math.round(amountUsd * 100)],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Quote> => {
      const a = asset!;
      const amountInRaw = BigInt(Math.round(amountUsd * 1_000_000));
      const route = chain.routes[a.symbol];
      let expectedOutRaw: bigint;
      if (a.via === "aave_v3") {
        expectedOutRaw = amountInRaw; // supply(USDC) mints aUSDC 1:1
      } else if (route) {
        expectedOutRaw = await quoteAlongRoute(chain, route.hops, amountInRaw);
      } else {
        expectedOutRaw = await quoteSingleHop(
          chain,
          { tokenIn: chain.usdc.address, tokenOut: a.address!, fee: a.feeTier ?? 3000, pool: a.pool! },
          amountInRaw,
        );
      }
      const expectedOutQty = fromUnits(expectedOutRaw, a.decimals!);
      const pricePerToken = expectedOutQty > 0 ? amountUsd / expectedOutQty : 0;
      return { amountInRaw, expectedOutRaw, expectedOutQty, pricePerToken };
    },
  });
}

export interface SellQuote {
  amountInRaw: bigint; // token, asset.decimals
  expectedUsdcRaw: bigint; // USDC, 6dp
  expectedUsd: number;
}

/**
 * Quote selling `tokenQtyRaw` raw units of `asset` into USDC. Routed assets quote
 * their route in REVERSE (asset -> ... -> USDC). Returns no data while
 * disabled/loading.
 */
export function useSellQuote(asset: Asset | null, tokenQtyRaw: bigint) {
  const chain = useChain();
  const enabled = Boolean(asset && asset.decimals && tokenQtyRaw > BigInt(0) && isRoutable(chain, asset.symbol));
  return useQuery({
    queryKey: ["sell-quote", chain.key, asset?.symbol, tokenQtyRaw.toString()],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<SellQuote> => {
      const a = asset!;
      const route = chain.routes[a.symbol];
      let expectedUsdcRaw: bigint;
      if (a.via === "aave_v3") {
        expectedUsdcRaw = tokenQtyRaw; // withdraw returns USDC 1:1
      } else if (route) {
        expectedUsdcRaw = await quoteAlongRoute(chain, reverseRoute(route.hops), tokenQtyRaw);
      } else {
        expectedUsdcRaw = await quoteSingleHop(
          chain,
          { tokenIn: a.address!, tokenOut: chain.usdc.address, fee: a.feeTier ?? 3000, pool: a.pool! },
          tokenQtyRaw,
        );
      }
      const expectedUsd = fromUnits(expectedUsdcRaw, chain.usdc.decimals);
      return { amountInRaw: tokenQtyRaw, expectedUsdcRaw, expectedUsd };
    },
  });
}
