"use client";

// On-chain balance reads via the shared read-only public client.
//
//   useUsdcBalance(address)   -> spendable dollars (USDC, 6dp)
//   usePortfolio(address)     -> buyable-token balances + approximate USD value
//
// USD valuation is approximate: we price each xStock off its Fluxion pool spot
// (sqrtPriceX96), the same source the backend uses to quote legs. Crypto/safe
// tiers without a pool show quantity only (value omitted).
import { useCallback } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { publicClient } from "@/lib/wagmi";
import { ERC20_ABI, V3_POOL_ABI } from "@/lib/abis";
import { USDC, STOCKS, ALL_ASSETS, type Asset } from "@/lib/mantle";
import { fromUnits } from "@/lib/format";
import { useDemo } from "@/components/demo/DemoProvider";

// Shared freshness policy for on-chain money reads: poll on a short interval AND
// refetch when the user returns to the tab / reconnects / re-mounts a screen, so
// a deposit or action shows up without a manual page refresh.
const LIVE_BALANCE_OPTS = {
  staleTime: 5_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchOnMount: "always",
  // Keep the last value on screen across refetches / address changes, so the
  // balance never blanks out mid-update.
  placeholderData: keepPreviousData,
} as const;

const Q192 = (BigInt(2) ** BigInt(96)) ** BigInt(2);

export interface Holding {
  asset: Asset;
  raw: bigint;
  qty: number;
  /** Approximate USD value, or undefined if unpriced. */
  valueUsd?: number;
  priceUsd?: number;
}

/** Spendable USDC balance (number, dollars). */
export function useUsdcBalance(address?: string) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["usdc-balance", address],
    enabled: !demo && Boolean(address),
    refetchInterval: 12_000,
    ...LIVE_BALANCE_OPTS,
    queryFn: async (): Promise<{ raw: bigint; value: number }> => {
      const raw = (await publicClient.readContract({
        address: USDC.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })) as bigint;
      return { raw, value: fromUnits(raw, USDC.decimals) };
    },
  });
  if (demo) return { ...query, data: demo.usdc, isLoading: false, isPending: false } as typeof query;
  return query;
}

/** Spot USDC price (per whole token) of a stock from its Fluxion pool. */
async function poolPriceUsd(asset: Asset): Promise<number | undefined> {
  if (!asset.pool || !asset.decimals) return undefined;
  try {
    const [slot0, token0] = await Promise.all([
      publicClient.readContract({ address: asset.pool, abi: V3_POOL_ABI, functionName: "slot0" }),
      publicClient.readContract({ address: asset.pool, abi: V3_POOL_ABI, functionName: "token0" }),
    ]);
    const sqrtPriceX96 = (slot0 as readonly bigint[])[0];
    const usdcIsToken0 = (token0 as string).toLowerCase() === USDC.address.toLowerCase();
    // Price of 1 whole xStock in USDC. Quote a 1-token sell to get robust integer math.
    const oneToken = BigInt(10) ** BigInt(asset.decimals);
    const priceX192 = sqrtPriceX96 * sqrtPriceX96;
    // usdcOut(raw 6dp) for selling 1 whole xStock:
    const usdcOutRaw = usdcIsToken0
      ? (oneToken * Q192) / priceX192 // USDC is token0: out = in / price
      : (oneToken * priceX192) / Q192; // USDC is token1: out = in * price
    return fromUnits(usdcOutRaw, USDC.decimals);
  } catch {
    return undefined;
  }
}

/**
 * Read balances of the buyable tokens for `address` and value them approximately.
 * Returns only non-zero holdings, plus the summed approximate USD value.
 */
export function usePortfolio(address?: string) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["portfolio", address],
    enabled: !demo && Boolean(address),
    refetchInterval: 15_000,
    ...LIVE_BALANCE_OPTS,
    queryFn: async (): Promise<{ holdings: Holding[]; totalUsd: number }> => {
      const balances = await Promise.all(
        ALL_ASSETS.map(async (asset) => {
          if (!asset.address || !asset.decimals) return null;
          try {
            const raw = (await publicClient.readContract({
              address: asset.address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address as `0x${string}`],
            })) as bigint;
            if (raw === BigInt(0)) return null;
            return { asset, raw };
          } catch {
            return null;
          }
        }),
      );

      const live = balances.filter((b): b is { asset: Asset; raw: bigint } => b !== null);

      const holdings: Holding[] = await Promise.all(
        live.map(async ({ asset, raw }) => {
          const qty = fromUnits(raw, asset.decimals!);
          const priceUsd = await poolPriceUsd(asset);
          const valueUsd = priceUsd !== undefined ? qty * priceUsd : undefined;
          return { asset, raw, qty, valueUsd, priceUsd };
        }),
      );

      const totalUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
      // Stable order: stocks first (largest value), then others.
      holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
      return { holdings, totalUsd };
    },
  });
  if (demo) return { ...query, data: demo.portfolio, isLoading: false, isPending: false } as typeof query;
  return query;
}

/** True if `symbol` is a buyable stock-tier xStock (the only tier the executor routes today). */
export function isBuyableStock(symbol: string): boolean {
  return STOCKS.some((s) => s.symbol === symbol);
}

/**
 * Returns a function that invalidates the money queries (cash, portfolio,
 * activity) so they refetch immediately. Call it right after any successful
 * on-chain write — invest, buy/sell, send — so the UI reflects the new balance
 * without waiting for the poll interval or a manual page refresh.
 */
export function useRefreshBalances() {
  const qc = useQueryClient();
  return useCallback(() => {
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["usdc-balance"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    };
    invalidate();
    // The read RPC can trail the bundler by a block right after inclusion, so a
    // second pass a moment later catches the settled state.
    setTimeout(invalidate, 2500);
  }, [qc]);
}
