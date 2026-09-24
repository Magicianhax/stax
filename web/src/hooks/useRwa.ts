"use client";

// useRwa — the BSC tokenized-stock catalog from /api/rwa (Task 9, not built yet in this wave):
// each ticker's on-chain price next to its underlying reference, whether each issuer is
// trading it right now, and which venue a buy should use (lib/rwa.ts has the shapes). Off BSC
// there is nothing to fetch, so the query stays disabled and every caller gets `undefined`
// rather than special-casing the network. Until Task 9 merges, the route 404s and this hook
// just reports the load as failed — the UI already treats a missing ticker as "no signal",
// never as "closed", so nothing here can fake a market status it doesn't have.
import { useQuery } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import type { RwaTickerView, VenueView } from "@/lib/rwa";

export interface RwaResponse {
  chain: "bsc";
  tickers: RwaTickerView[];
  asOf: string;
}

async function fetchRwa(): Promise<RwaResponse> {
  const res = await authedFetch("/api/rwa");
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load market data.");
  }
  return json as RwaResponse;
}

/** The full BSC catalog. Disabled — `data` stays undefined — on every other chain. */
export function useRwa() {
  const chain = useChain();
  const enabled = chain.key === "bsc";
  return useQuery({
    queryKey: ["rwa", chain.key],
    queryFn: fetchRwa,
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 30_000 : false,
  });
}

/** One ticker's catalog row — undefined while loading, off BSC, or not (yet) listed. */
export function useRwaTicker(symbol: string | undefined): RwaTickerView | undefined {
  const { data } = useRwa();
  if (!symbol) return undefined;
  return data?.tickers.find((t) => t.ticker === symbol);
}

/** The venue a compact, single-line display should lead with: `bestVenue`, else whichever is first. */
export function primaryVenue(t: RwaTickerView): VenueView | undefined {
  if (t.bestVenue) return t.venues.find((v) => v.platform === t.bestVenue);
  return t.venues[0];
}
