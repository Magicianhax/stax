"use client";

// useEarnings — the next earnings date for each BSC stock, from /api/earnings (Yahoo, cached 12h
// on the server; Binance has no earnings data). Off BSC there is nothing to fetch. A missing or
// failed entry renders as "not announced", never as a guessed date.
import { useQuery } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import type { EarningsInfo, EarningsMap } from "@/lib/earnings";

async function fetchEarnings(): Promise<EarningsMap> {
  const res = await authedFetch("/api/earnings?chain=bsc");
  if (!res.ok) throw new Error("Couldn't load earnings dates.");
  const json = (await res.json()) as { earnings?: EarningsMap };
  return json.earnings ?? {};
}

/** One stock's next earnings, or undefined while loading, off BSC, or when it has none (ETFs, crypto). */
export function useEarnings(symbol: string | undefined): EarningsInfo | undefined {
  const chain = useChain();
  const { data } = useQuery({
    queryKey: ["earnings", chain.key],
    queryFn: fetchEarnings,
    enabled: chain.key === "bsc",
    staleTime: 60 * 60_000,
  });
  return symbol ? data?.[symbol] : undefined;
}
