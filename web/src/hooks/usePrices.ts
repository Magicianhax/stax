"use client";

// usePrices — live USD spot for every asset on the active chain, from
// /api/prices (DEX-pool reads, cached server-side). Use `usePrice(symbol)` for a
// single headline price.
//
// The returned price is the REAL on-chain spot (Uniswap pools on Base; Fluxion
// for stocks and the Agni route for mETH on Mantle). Assets with no live source
// return undefined — callers should fall back honestly (e.g. show the indicative
// reference or a dash), never fake.
import { useQuery } from "@tanstack/react-query";
import type { AssetPrice } from "@/lib/prices";
import type { ChainKey } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";

export interface PricesResponse {
  chain: ChainKey;
  prices: Record<string, AssetPrice>;
  asOf: string;
}

/** Fetch live prices for the ACTIVE chain (the chain header is attached by authedFetch). */
export async function fetchPrices(): Promise<PricesResponse> {
  const res = await authedFetch("/api/prices");
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load prices.");
  }
  return json as PricesResponse;
}

/** All live asset prices (symbol -> AssetPrice). Refreshes every 30s; re-keyed on chain switch. */
export function usePrices() {
  const chain = useChain();
  return useQuery({
    queryKey: ["prices", chain.key],
    queryFn: fetchPrices,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

/** Convenience: the live USD price for one symbol (undefined while loading / no source). */
export function usePrice(symbol: string | undefined): { priceUsd?: number; isLoading: boolean } {
  const { data, isLoading } = usePrices();
  if (!symbol) return { priceUsd: undefined, isLoading };
  return { priceUsd: data?.prices[symbol]?.priceUsd, isLoading };
}

/** The full price record for one symbol (venue spot, reference price + age, APY, shares per token). */
export function useAssetPrice(symbol: string | undefined): { price?: AssetPrice; isLoading: boolean } {
  const { data, isLoading } = usePrices();
  if (!symbol) return { price: undefined, isLoading };
  return { price: data?.prices[symbol], isLoading };
}
