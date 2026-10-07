"use client";

// useTransactions — a wallet's incoming + outgoing transfer history on the
// active chain, from /api/transactions (Etherscan V2 + on-chain fallback).
// Refreshes on focus and on a short interval, like the balance hooks, so new
// transfers show without a manual refresh. Keyed by chain. Inert in demo mode.
import { useQuery } from "@tanstack/react-query";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import { useDemo } from "@/components/demo/DemoProvider";
import type { WalletTx } from "@/lib/walletTx";

async function fetchTransactions(address: string): Promise<WalletTx[]> {
  const res = await authedFetch(`/api/transactions?address=${address}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load transactions.");
  }
  return (json.transactions ?? []) as WalletTx[];
}

export function useTransactions(address?: string) {
  const demo = useDemo();
  const chain = useChain();
  const query = useQuery({
    queryKey: ["transactions", chain.key, address],
    enabled: !demo && Boolean(address),
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: () => fetchTransactions(address as string),
  });
  if (demo) return { ...query, data: demo.transactions as WalletTx[], isLoading: false, isPending: false } as typeof query;
  return query;
}
