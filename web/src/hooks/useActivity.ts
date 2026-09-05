"use client";

// useActivity — a user's REAL Stax on-chain history (AI invests via the executor)
// on the active chain, newest first, with explorer links. Powers the
// activity/receipts UI.
//
// Fetched via /api/activity (Etherscan-indexed, server-cached): the browser
// can't eth_getLogs the full deploy→latest range against the public RPC (its
// 10k-block range cap made the old direct scan fail and show no history).
// On a chain whose executor isn't deployed yet there is no history: the hook
// resolves to an empty list without calling the API.
import { useQuery } from "@tanstack/react-query";
import type { ActivityRow } from "@/lib/onchainHistory";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import { useDemo } from "@/components/demo/DemoProvider";

export type { ActivityRow };

const EMPTY: ActivityRow[] = [];

export function useActivity(address?: string) {
  const demo = useDemo();
  const chain = useChain();
  const live = chain.contracts.deployed;
  const query = useQuery({
    queryKey: ["activity", chain.key, address],
    enabled: !demo && live && Boolean(address),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<ActivityRow[]> => {
      const res = await authedFetch(`/api/activity?address=${address}`);
      if (!res.ok) throw new Error(`activity failed: ${res.status}`);
      const json = (await res.json()) as {
        activity: (Omit<ActivityRow, "blockNumber"> & { blockNumber: number })[];
      };
      return json.activity.map((a) => ({ ...a, blockNumber: BigInt(a.blockNumber) }));
    },
  });
  if (demo) return { ...query, data: demo.activity, isLoading: false, isPending: false } as typeof query;
  if (!live) return { ...query, data: EMPTY, isLoading: false, isPending: false } as typeof query;
  return query;
}
