"use client";

// useSavings — Savings (BSC only): "Move money in" deposits spendable cash into Venus's USDT
// market through Binance's DeFi API; "Move money out" redeems it back. Same direct smart-account
// shape as useInvest's ADR-0005 path — the server returns calls, `assertSavingsCallsAreSafe`
// (lib/execution.ts) checks every recipient against Savings' own pinned allowlist before the
// wallet is ever asked to sign, and the calls are sent as one sponsored UserOp.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { useChain } from "@/lib/chains/active";
import { assertSavingsCallsAreSafe, type ExecCall } from "@/lib/execution";
import { authedFetch } from "@/lib/authedFetch";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import type { SavingsRateResponse } from "@/app/api/savings/route";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Phase = "idle" | "moving" | "done" | "error";

/** The current Venus USDT rate. Public data — fetched whether or not the user is signed in, and
 *  on every chain (it just reads `{ available: false }` off BSC), so the WalletScreen card can
 *  decide its own copy without a loading flash on every visit. */
export function useSavingsRate() {
  const demo = useDemo();
  const chain = useChain();
  return useQuery({
    queryKey: ["savings-rate", chain.key],
    enabled: !demo,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<SavingsRateResponse> => {
      const res = await fetch(`/api/savings`, { headers: { "x-stax-chain": chain.key } });
      if (!res.ok) throw new Error("Couldn't load the savings rate.");
      return res.json();
    },
  });
}

/**
 * The caller's current Savings balance in dollars (BSC only — reads GET /api/savings?address=…,
 * see getSavingsBalanceUsd's doc comment in lib/server/savings.ts for how it's computed).
 *
 * Review fix (wave 5b): before this hook existed, nothing on the client ever read this balance —
 * a deposit made the money look like it had vanished, since the card showed no line for it at all.
 */
export function useSavingsBalance(address?: string) {
  const demo = useDemo();
  const chain = useChain();
  const query = useQuery({
    queryKey: ["savings-balance-usd", chain.key, address],
    enabled: !demo && chain.key === "bsc" && Boolean(address),
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<number | null> => {
      const res = await fetch(`/api/savings?address=${address}`, { headers: { "x-stax-chain": chain.key } });
      if (!res.ok) throw new Error("Couldn't load your Savings balance.");
      const json = (await res.json()) as SavingsRateResponse;
      return json.balanceUsd ?? null;
    },
  });
  if (demo) return { ...query, data: demo.savings?.balanceUsd ?? 0, isLoading: false, isPending: false } as typeof query;
  return query;
}

export function useSavings() {
  const activeWallet = useActiveWallet();
  const chain = useChain();
  const demo = useDemo();
  const refreshBalances = useRefreshBalances();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTxHash(null);
  }, []);

  const run = useCallback(
    async (body: { action: "deposit"; amountUsd: number } | { action: "redeem"; ratio: number }, address: `0x${string}`) => {
      setError(null);
      if (demo) {
        setPhase("moving");
        await sleep(1200);
        // Simulated: nothing is sent. The balance and cash move in the demo's own session only.
        const balance = demo.savings?.balanceUsd ?? 0;
        const usd = body.action === "deposit" ? body.amountUsd : -Math.min(balance, balance * body.ratio);
        setTxHash(demo.recordSavings(Number(usd.toFixed(2))));
        setPhase("done");
        return;
      }
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        const res = await authedFetch("/api/savings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, address }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Savings didn't go through.");
        // Belt-and-suspenders: the client checks the same allowlist the server already applied,
        // exactly as useInvest.ts does for the direct-path invest calls — never trust a server
        // response to be safe just because it came from our own API.
        const calls = assertSavingsCallsAreSafe(chain, json.calls as ExecCall[]).map((c) => ({
          to: c.to,
          data: c.data,
          ...(c.value !== undefined ? { value: BigInt(c.value) } : {}),
        }));
        setPhase("moving");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const receipt = await sendSponsoredCalls(provider, calls, chain);
        setTxHash(receipt.receipt.transactionHash as `0x${string}`);
        setPhase("done");
        refreshBalances();
        // useRefreshBalances (useBalances.ts) only knows about cash/portfolio/activity — it has
        // no idea useSavingsBalance's own query key exists, so that one is invalidated here.
        void queryClient.invalidateQueries({ queryKey: ["savings-balance-usd"] });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Savings didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, chain, demo, refreshBalances, queryClient],
  );

  const moveIn = useCallback((amountUsd: number, address: string) => run({ action: "deposit", amountUsd }, address as `0x${string}`), [run]);
  const moveOut = useCallback((ratio: number, address: string) => run({ action: "redeem", ratio }, address as `0x${string}`), [run]);

  return { phase, error, txHash, busy: phase === "moving", moveIn, moveOut, reset };
}

