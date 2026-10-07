"use client";

// Client-side quotes for the Pro manual buy/sell panel, on the active chain.
//
//   useQuote(asset, amountUsd)     -> USDC in  -> asset out
//   useSellQuote(asset, tokenRaw)  -> asset in -> USDC out
//
// Base (aggregator chain): POST /api/swap-quote (KyberSwap, build=false), debounced 400ms
//   so a keystroke burst is one request; falls back to the Uniswap QuoterV2 / slot0 path
//   when the asset has a direct pool and the aggregator call fails (or before sign-in).
// Mantle: Fluxion pool spot for stocks, chained Agni hops for routed assets.
// Aave "safe dollars": 1:1 (aBasUSDC and USDC are both 6 dec).
// minOut is derived by the caller from a slippage buffer; the on-chain
// amountOutMinimum (and Kyber's own minReturn) is the real protection.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isRoutable, reverseRoute, type Asset, type RwaPlatform } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { fromUnits } from "@/lib/format";
import { quoteAlongRoute, quoteSingleHop } from "@/lib/swapRouting";
import { fetchSwapQuote, usesAggregator } from "@/lib/swapQuote";
import type { DryRun } from "@/lib/dryRun";
import { usdToRaw } from "@/lib/units";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useDemo } from "@/components/demo/DemoProvider";

const AGGREGATOR_DEBOUNCE_MS = 400;

/** Trailing debounce — the returned value lags `value` by `ms` while it keeps changing. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export interface Quote {
  amountInRaw: bigint; // USDC, 6dp
  expectedOutRaw: bigint; // tokenOut, asset.decimals
  expectedOutQty: number;
  pricePerToken: number; // USDC per whole token
  /** Aggregator quotes: the floor Kyber will enforce at the default slippage (raw). */
  minOutRaw?: bigint;
  /** BSC only, and only on a build=true quote: the Binance check this trade would face. */
  dryRun?: DryRun;
}

/**
 * Quote `amountUsd` of USDC into `asset`. Debounced via react-query keying on the
 * rounded amount (plus a 400ms input debounce on aggregator chains); keyed by chain
 * so a network switch re-quotes. Returns no data while disabled/loading.
 */
export function useQuote(asset: Asset | null, amountUsd: number, venue?: RwaPlatform) {
  const chain = useChain();
  const demo = useDemo();
  // Demo on BNB Chain: quoted from the demo market, never from Binance (lib/demo/bscMarket.ts).
  const demoMarket = chain.key === "bsc" && demo?.rwa ? demo : null;
  const { address } = useSmartAccount();
  const aggregator = usesAggregator(chain, asset);
  const amountCents = Math.round(amountUsd * 100);
  const debouncedCents = useDebounced(amountCents, AGGREGATOR_DEBOUNCE_MS);
  const cents = aggregator ? debouncedCents : amountCents;
  // Aggregator quotes need the signed-in account (sender/recipient); before that, an
  // asset with a direct pool can still be quoted from the pool.
  const canQuote = aggregator ? Boolean(address) || Boolean(asset?.pool) : true;
  const enabled = Boolean(asset && asset.decimals && cents > 0 && isRoutable(chain, asset.symbol) && canQuote);
  return useQuery({
    queryKey: ["quote", chain.key, asset?.symbol, "buy", cents, aggregator ? address : null, venue ?? null, demoMarket ? `demo:${demoMarket.nowMs}` : null],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    // A refusal (closed market, sub-$6) is the server's final word, not a transient failure —
    // retrying it burns another call against Binance's 5-per-window budget for the same answer.
    retry: false,
    queryFn: async (): Promise<Quote> => {
      const a = asset!;
      // Chain-aware: `10_000` * cents is only correct on 6-decimal USDC. BSC's cash is
      // 18-decimal USDT, and usesAggregator() routes it through this same aggregator branch
      // (see swapQuote.ts), so a hardcoded multiply under-quoted every BSC buy by 10^12x.
      const amountInRaw = usdToRaw(chain, cents / 100);
      const route = chain.routes[a.symbol];
      let expectedOutRaw: bigint;
      let minOutRaw: bigint | undefined;
      let dryRun: DryRun | undefined;
      if (demoMarket) {
        // A short beat, like a real price check, then the same refusals the server makes.
        await new Promise((r) => setTimeout(r, 220));
        const q = demoMarket.quote({ asset: a, side: "buy", amountIn: amountInRaw, venue });
        expectedOutRaw = q.amountOut;
        minOutRaw = q.minOut;
        dryRun = q.dryRun;
      } else if (a.via === "aave_v3") {
        expectedOutRaw = amountInRaw; // supply(USDC) mints aUSDC 1:1
      } else if (aggregator && address) {
        try {
          const q = await fetchSwapQuote({
            symbol: a.symbol,
            side: "buy",
            amountIn: amountInRaw,
            sender: address,
            recipient: address,
            venue,
          });
          expectedOutRaw = q.amountOut;
          minOutRaw = q.minOut;
          dryRun = q.dryRun;
        } catch (e) {
          if (!a.pool) throw e;
          expectedOutRaw = await quoteSingleHop(
            chain,
            { tokenIn: chain.usdc.address, tokenOut: a.address!, fee: a.feeTier ?? 3000, pool: a.pool },
            amountInRaw,
          );
        }
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
      const pricePerToken = expectedOutQty > 0 ? cents / 100 / expectedOutQty : 0;
      return {
        amountInRaw,
        expectedOutRaw,
        expectedOutQty,
        pricePerToken,
        ...(minOutRaw !== undefined ? { minOutRaw } : {}),
        ...(dryRun ? { dryRun } : {}),
      };
    },
  });
}

export interface SellQuote {
  amountInRaw: bigint; // token, asset.decimals
  expectedUsdcRaw: bigint; // USDC, 6dp
  expectedUsd: number;
  /** Aggregator quotes: the USDC floor Kyber will enforce at the default slippage (raw). */
  minUsdcRaw?: bigint;
  /** BSC only, and only on a build=true quote: the Binance check this trade would face. */
  dryRun?: DryRun;
}

/**
 * Quote selling `tokenQtyRaw` raw units of `asset` into USDC. Routed assets quote
 * their route in REVERSE (asset -> ... -> USDC). Returns no data while
 * disabled/loading.
 */
export function useSellQuote(asset: Asset | null, tokenQtyRaw: bigint, venue?: RwaPlatform) {
  const chain = useChain();
  const demo = useDemo();
  const demoMarket = chain.key === "bsc" && demo?.rwa ? demo : null;
  const { address } = useSmartAccount();
  const aggregator = usesAggregator(chain, asset);
  const rawKey = tokenQtyRaw.toString();
  const debouncedKey = useDebounced(rawKey, AGGREGATOR_DEBOUNCE_MS);
  const qtyKey = aggregator ? debouncedKey : rawKey;
  const canQuote = aggregator ? Boolean(address) || Boolean(asset?.pool) : true;
  const enabled = Boolean(asset && asset.decimals && qtyKey !== "0" && isRoutable(chain, asset.symbol) && canQuote);
  return useQuery({
    queryKey: ["sell-quote", chain.key, asset?.symbol, "sell", qtyKey, aggregator ? address : null, venue ?? null, demoMarket ? `demo:${demoMarket.nowMs}` : null],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    // Same reasoning as useQuote: a refusal is final, so retrying just doubles the Binance call.
    retry: false,
    queryFn: async (): Promise<SellQuote> => {
      const a = asset!;
      const amountInRaw = BigInt(qtyKey);
      const route = chain.routes[a.symbol];
      let expectedUsdcRaw: bigint;
      let minUsdcRaw: bigint | undefined;
      let dryRun: DryRun | undefined;
      if (demoMarket) {
        await new Promise((r) => setTimeout(r, 220));
        const q = demoMarket.quote({ asset: a, side: "sell", amountIn: amountInRaw, venue });
        expectedUsdcRaw = q.amountOut;
        minUsdcRaw = q.minOut;
        dryRun = q.dryRun;
      } else if (a.via === "aave_v3") {
        expectedUsdcRaw = amountInRaw; // withdraw returns USDC 1:1
      } else if (aggregator && address) {
        try {
          const q = await fetchSwapQuote({
            symbol: a.symbol,
            side: "sell",
            amountIn: amountInRaw,
            sender: address,
            recipient: address,
            venue,
          });
          expectedUsdcRaw = q.amountOut;
          minUsdcRaw = q.minOut;
          dryRun = q.dryRun;
        } catch (e) {
          if (!a.pool) throw e;
          expectedUsdcRaw = await quoteSingleHop(
            chain,
            { tokenIn: a.address!, tokenOut: chain.usdc.address, fee: a.feeTier ?? 3000, pool: a.pool },
            amountInRaw,
          );
        }
      } else if (route) {
        expectedUsdcRaw = await quoteAlongRoute(chain, reverseRoute(route.hops), amountInRaw);
      } else {
        expectedUsdcRaw = await quoteSingleHop(
          chain,
          { tokenIn: a.address!, tokenOut: chain.usdc.address, fee: a.feeTier ?? 3000, pool: a.pool! },
          amountInRaw,
        );
      }
      const expectedUsd = fromUnits(expectedUsdcRaw, chain.usdc.decimals);
      return {
        amountInRaw,
        expectedUsdcRaw,
        expectedUsd,
        ...(minUsdcRaw !== undefined ? { minUsdcRaw } : {}),
        ...(dryRun ? { dryRun } : {}),
      };
    },
  });
}
