"use client";

// useVeraRecord — Vera's REAL on-chain track record from the StaxExecutor log on
// the active chain, plus her IdentityRegistry reputation score. Global by
// default; pass an address to scope to one user.
//
// Fetched via /api/vera-record (Etherscan-indexed, server-cached): the browser
// can't eth_getLogs the full deploy→latest range against the public RPC — its
// 10k-block range cap made the old direct scan fail and read as zeros.
// Returns a clean 0-state on empty history (no faked numbers), and the same
// 0-state without any call on a chain whose executor isn't deployed yet.
import { useQuery } from "@tanstack/react-query";
import type { VeraRecord } from "@/lib/onchainHistory";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import { useDemo } from "@/components/demo/DemoProvider";

export interface VeraRecordData extends VeraRecord {
  reputation?: bigint;
}

interface ApiRecord extends Omit<VeraRecord, "recentRecommendations"> {
  recentRecommendations: (Omit<VeraRecord["recentRecommendations"][number], "blockNumber"> & {
    blockNumber: number;
  })[];
}

const EMPTY_RECORD: VeraRecordData = {
  totalRecommendations: 0,
  totalExecutedUsd: 0,
  executedCount: 0,
  recentRecommendations: [],
};

export function useVeraRecord(user?: `0x${string}`) {
  const demo = useDemo();
  const chain = useChain();
  const live = chain.contracts.deployed;
  const query = useQuery({
    queryKey: ["vera-record", chain.key, user ?? "global"],
    enabled: !demo && live,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<VeraRecordData> => {
      const qs = user ? `?user=${user}` : "";
      const res = await authedFetch(`/api/vera-record${qs}`);
      if (!res.ok) throw new Error(`vera-record failed: ${res.status}`);
      const json = (await res.json()) as { record: ApiRecord; reputation: string | null };
      return {
        ...json.record,
        recentRecommendations: json.record.recentRecommendations.map((r) => ({
          ...r,
          blockNumber: BigInt(r.blockNumber),
        })),
        reputation: json.reputation === null ? undefined : BigInt(json.reputation),
      };
    },
  });
  if (demo) return { ...query, data: demo.veraRecord, isLoading: false, isPending: false } as typeof query;
  if (!live) return { ...query, data: EMPTY_RECORD, isLoading: false, isPending: false } as typeof query;
  return query;
}
