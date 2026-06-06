"use client";

// useVeraRecord — Vera's REAL on-chain track record from the StaxExecutor log,
// plus her IdentityRegistry reputation score. Replaces the sample track record on
// the Vera screen. Global by default; pass an address to scope to one user.
//
// Returns a clean 0-state on empty history (no faked numbers).
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "@/lib/wagmi";
import { getVeraRecord, type VeraRecord } from "@/lib/onchainHistory";
import { IDENTITY_REGISTRY_ABI } from "@/lib/abis";
import { useDemo } from "@/components/demo/DemoProvider";

const IDENTITY_REGISTRY = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ||
  "0x9f147a87f131408dd0bd750c16ac782620572abf") as `0x${string}`;
const AGENT_ID = BigInt(process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1");

export interface VeraRecordData extends VeraRecord {
  reputation?: bigint;
}

export function useVeraRecord(user?: `0x${string}`) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["vera-record", user ?? "global"],
    enabled: !demo,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<VeraRecordData> => {
      const [record, reputation] = await Promise.all([
        getVeraRecord(publicClient, user),
        publicClient
          .readContract({
            address: IDENTITY_REGISTRY,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "reputationScore",
            args: [AGENT_ID],
          })
          .then((r) => r as bigint)
          .catch(() => undefined),
      ]);
      return { ...record, reputation };
    },
  });
  if (demo) return { ...query, data: demo.veraRecord, isLoading: false, isPending: false } as typeof query;
  return query;
}
