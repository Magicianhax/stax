"use client";

// Client-side spot quote for the Pro manual-buy panel.
// Reads the asset's Fluxion pool slot0 and estimates token-out for a USDC-in,
// mirroring the backend leg builder's math. minOut is derived from a slippage
// buffer; the on-chain amountOutMinimum is the real protection.
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "@/lib/wagmi";
import { V3_POOL_ABI } from "@/lib/abis";
import { USDC, ASSET_ROUTES, reverseRoute, type Asset, type RouteHop } from "@/lib/mantle";
import { fromUnits } from "@/lib/format";

const Q192 = (BigInt(2) ** BigInt(96)) ** BigInt(2);

export interface Quote {
  amountInRaw: bigint; // USDC, 6dp
  expectedOutRaw: bigint; // tokenOut, asset.decimals
  expectedOutQty: number;
  pricePerToken: number; // USDC per whole token
}

function expectedOut(sqrtPriceX96: bigint, amountInRaw: bigint, usdcIsToken0: boolean): bigint {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  if (usdcIsToken0) return (amountInRaw * priceX192) / Q192;
  if (priceX192 === BigInt(0)) return BigInt(0);
  return (amountInRaw * Q192) / priceX192;
}

/**
 * Chain the spot price across a multi-hop route to get expected final-token out.
 * Direction-agnostic: works for buys (USDC -> asset) and reversed sells
 * (asset -> USDC) — each hop infers its own direction from the pool's token0.
 */
async function expectedOutAlongRoute(hops: RouteHop[], amountInRaw: bigint): Promise<bigint> {
  const states = await Promise.all(
    hops.map((h) =>
      Promise.all([
        publicClient.readContract({ address: h.pool, abi: V3_POOL_ABI, functionName: "slot0" }),
        publicClient.readContract({ address: h.pool, abi: V3_POOL_ABI, functionName: "token0" }),
      ]),
    ),
  );
  let amount = amountInRaw;
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i];
    const sqrtPriceX96 = (states[i][0] as readonly bigint[])[0];
    const tokenInIsToken0 = (states[i][1] as string).toLowerCase() === h.tokenIn.toLowerCase();
    amount = expectedOut(sqrtPriceX96, amount, tokenInIsToken0);
    if (amount === BigInt(0)) return BigInt(0);
  }
  return amount;
}

/**
 * Quote `amountUsd` of USDC into `asset`. Stocks quote off their Fluxion pool;
 * routed SAFE/CRYPTO assets (sUSDe/mETH) chain their validated Agni hops. Debounced
 * via react-query keying on the rounded amount. Returns null while disabled/loading.
 */
export function useQuote(asset: Asset | null, amountUsd: number) {
  const route = asset ? ASSET_ROUTES[asset.symbol] : undefined;
  const enabled = Boolean(
    asset?.address && asset?.decimals && amountUsd > 0 && (asset?.pool || route),
  );
  return useQuery({
    queryKey: ["quote", asset?.symbol, Math.round(amountUsd * 100)],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Quote> => {
      const a = asset!;
      const amountInRaw = BigInt(Math.round(amountUsd * 1_000_000));
      let expectedOutRaw: bigint;
      if (route) {
        expectedOutRaw = await expectedOutAlongRoute(route.hops, amountInRaw);
      } else {
        const [slot0, token0] = await Promise.all([
          publicClient.readContract({ address: a.pool!, abi: V3_POOL_ABI, functionName: "slot0" }),
          publicClient.readContract({ address: a.pool!, abi: V3_POOL_ABI, functionName: "token0" }),
        ]);
        const sqrtPriceX96 = (slot0 as readonly bigint[])[0];
        const usdcIsToken0 = (token0 as string).toLowerCase() === USDC.address.toLowerCase();
        expectedOutRaw = expectedOut(sqrtPriceX96, amountInRaw, usdcIsToken0);
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
 * Quote selling `tokenQtyRaw` raw units of `asset` into USDC. Stocks quote off
 * their Fluxion pool spot; routed SAFE/CRYPTO assets (sUSDe/mETH) chain their
 * validated Agni hops in REVERSE (asset -> ... -> USDC). Returns null while
 * disabled/loading.
 */
export function useSellQuote(asset: Asset | null, tokenQtyRaw: bigint) {
  const route = asset ? ASSET_ROUTES[asset.symbol] : undefined;
  const enabled = Boolean(
    asset?.address && asset?.decimals && tokenQtyRaw > BigInt(0) && (asset?.pool || route),
  );
  return useQuery({
    queryKey: ["sell-quote", asset?.symbol, tokenQtyRaw.toString()],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<SellQuote> => {
      const a = asset!;
      let expectedUsdcRaw: bigint;
      if (route) {
        expectedUsdcRaw = await expectedOutAlongRoute(reverseRoute(route.hops), tokenQtyRaw);
      } else {
        const [slot0, token0] = await Promise.all([
          publicClient.readContract({ address: a.pool!, abi: V3_POOL_ABI, functionName: "slot0" }),
          publicClient.readContract({ address: a.pool!, abi: V3_POOL_ABI, functionName: "token0" }),
        ]);
        const sqrtPriceX96 = (slot0 as readonly bigint[])[0];
        const usdcIsToken0 = (token0 as string).toLowerCase() === USDC.address.toLowerCase();
        // Selling the asset = USDC is the OUTPUT, so invert the buy-side branch.
        expectedUsdcRaw = expectedOut(sqrtPriceX96, tokenQtyRaw, !usdcIsToken0);
      }
      const expectedUsd = fromUnits(expectedUsdcRaw, USDC.decimals);
      return { amountInRaw: tokenQtyRaw, expectedUsdcRaw, expectedUsd };
    },
  });
}
