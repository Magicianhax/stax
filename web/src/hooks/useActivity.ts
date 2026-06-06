"use client";

// useActivity — a user's REAL Stax on-chain history (AI invests via the executor),
// newest first, with Mantlescan links. Powers the activity/receipts UI.
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "@/lib/wagmi";
import { getUserActivity, type ActivityRow } from "@/lib/onchainHistory";
import { useDemo } from "@/components/demo/DemoProvider";

export type { ActivityRow };

export function useActivity(address?: string) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["activity", address],
    enabled: !demo && Boolean(address),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<ActivityRow[]> => {
      return getUserActivity(publicClient, address as `0x${string}`);
    },
  });
  if (demo) return { ...query, data: demo.activity, isLoading: false, isPending: false } as typeof query;
  return query;
}
