"use client";

// useSavings — Savings (BSC only): "Move money in" deposits spendable cash into Venus's USDT
// market through Binance's DeFi API; "Move money out" redeems it back. Same direct smart-account
// shape as useInvest's ADR-0005 path — the server returns calls, `assertSavingsCallsAreSafe`
// (lib/execution.ts) checks every recipient against Savings' own pinned allowlist before the
// wallet is ever asked to sign, and the calls are sent as one sponsored UserOp.
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
const DEMO_SAVINGS_TX = ("0x" + "5a7c2b41".repeat(32).slice(0, 64)) as `0x${string}`;
const DEMO_RATE: SavingsRateResponse = { chain: "bsc", available: true, apyBps: 420, apyDisplay: "4.20%" };

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

export function useSavings() {
  const activeWallet = useActiveWallet();
  const chain = useChain();
  const demo = useDemo();
  const refreshBalances = useRefreshBalances();
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
        setTxHash(DEMO_SAVINGS_TX);
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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Savings didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, chain, demo, refreshBalances],
  );

  const moveIn = useCallback((amountUsd: number, address: string) => run({ action: "deposit", amountUsd }, address as `0x${string}`), [run]);
  const moveOut = useCallback((ratio: number, address: string) => run({ action: "redeem", ratio }, address as `0x${string}`), [run]);

  return { phase, error, txHash, busy: phase === "moving", moveIn, moveOut, reset };
}

/** The demo-mode rate, for screens that render before useSavingsRate's query is enabled. */
export const DEMO_SAVINGS_RATE = DEMO_RATE;
