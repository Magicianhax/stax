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
import { assetBySymbol } from "@/lib/chains";
import { authedFetch } from "@/lib/authedFetch";
import { useDemo } from "@/components/demo/DemoProvider";
import type { RwaListResponse, RwaTickerView, VenueView } from "@/lib/rwa";

async function fetchRwa(): Promise<RwaListResponse> {
  const res = await authedFetch("/api/rwa?chain=bsc");
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load market data.");
  }
  return json as RwaListResponse;
}

/** The full BSC catalog. Disabled — `data` stays undefined — on every other chain. */
export function useRwa() {
  const chain = useChain();
  const demo = useDemo();
  const enabled = chain.key === "bsc" && !demo;
  const query = useQuery({
    queryKey: ["rwa", chain.key],
    queryFn: fetchRwa,
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 30_000 : false,
  });
  // Demo: the demo market (lib/demo/bscMarket.ts), no request to Binance or to our API.
  if (demo?.rwa) return { ...query, data: demo.rwa, isLoading: false, isPending: false, isError: false, error: null } as typeof query;
  return query;
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

/** The venue a manual buy from this screen will actually use — the one whose token address is
 * the asset's own, since the trade screen resolves a symbol straight to `asset.address` and
 * never lets the buy flow aim at a different issuer. This is deliberately NOT `bestVenue`: the
 * catalog's best venue is whichever issuer is trading tightest to the reference right now, which
 * can be the twin while the default issuer is paused. */
export function buyVenueFor(ticker: RwaTickerView | undefined, address: string | undefined): VenueView | undefined {
  if (!ticker || !address) return undefined;
  const lower = address.toLowerCase();
  return ticker.venues.find((v) => v.address.toLowerCase() === lower);
}

export type BscBuyGate =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; buyable: boolean; venue: VenueView | undefined };

/**
 * Whether BSC's manual buy button should be enabled, and why. Fails closed: only a loaded
 * catalog with a buyable venue at the asset's own address enables it. Everything else —
 * still loading, a fetch error (Binance's 5-per-window budget, or the 404 before Task 9
 * merges), or a symbol the catalog doesn't list — reads as "can't confirm this is open",
 * never as "go ahead". Kept pure (no query object) so the rule is a plain Node test; hooks
 * call it, they don't reimplement it.
 */
export function bscBuyGate(params: {
  ticker: RwaTickerView | undefined;
  address: string | undefined;
  isLoading: boolean;
  isError: boolean;
}): BscBuyGate {
  if (params.isLoading) return { status: "loading" };
  if (params.isError || !params.ticker) return { status: "unavailable" };
  const venue = buyVenueFor(params.ticker, params.address);
  return { status: "ready", buyable: Boolean(venue?.buyable), venue };
}

/** `bscBuyGate` wired to the live catalog query, for the one screen that gates a buy on it. */
export function useBscBuyGate(symbol: string | undefined, address: string | undefined): BscBuyGate {
  const chain = useChain();
  const { data, isLoading, isError } = useRwa();
  // Crypto (BTCB, ETH, BNB) isn't in the RWA catalog and has no market hours: always open.
  if (symbol && assetBySymbol(chain, symbol)?.tier === "crypto") return { status: "ready", buyable: true, venue: undefined };
  const ticker = symbol ? data?.tickers.find((t) => t.ticker === symbol) : undefined;
  return bscBuyGate({ ticker, address, isLoading, isError });
}
