"use client";

// useInvest — the heart of the Lite happy-path.
//
//   allocate(goal, amount)  -> AI builds an allocation (POST /api/allocate)
//   invest(allocation, ...) -> server signs a plan (POST /api/invest-plan),
//                              then we send ONE batched gasless UserOp:
//                                [ USDC.approve(executor, total),
//                                  executor.investWithAI(plan, inf, legs, total) ]
//
// All signing of the risk inference happens server-side with the agent key;
// the browser only relays the already-signed plan to the smart account.
import { useCallback, useState } from "react";
import { encodeFunctionData } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls, type Call } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { ERC20_ABI, STAX_EXECUTOR_ABI } from "@/lib/abis";
import { USDC } from "@/lib/mantle";
import { STAX_TREASURY } from "@/lib/fees";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { authHeader } from "@/lib/authedFetch";
import type { Allocation } from "@/lib/allocation-schema";
import type { AllocateResult, InvestPlanResult, InvestSuccess } from "@/lib/invest-types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Phase = "idle" | "thinking" | "planning" | "approving" | "investing" | "done" | "error";

export interface UseInvest {
  phase: Phase;
  error: string | null;
  allocation: AllocateResult | null;
  success: InvestSuccess | null;
  busy: boolean;
  allocate: (goal: string, amountUsd: number, riskTolerance?: string) => Promise<AllocateResult | null>;
  invest: (allocation: Allocation, amountUsd: number, address: string) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Something went wrong.");
  }
  return json as T;
}

export function useInvest(): UseInvest {
  const demo = useDemo();
  const activeWallet = useActiveWallet();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [allocation, setAllocation] = useState<AllocateResult | null>(null);
  const [success, setSuccess] = useState<InvestSuccess | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setAllocation(null);
    setSuccess(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const allocate = useCallback(
    async (goal: string, amountUsd: number, riskTolerance?: string) => {
      setError(null);
      setSuccess(null);
      setPhase("thinking");
      // Demo: canned plan after a believable "thinking" beat, no AI call.
      if (demo) {
        await sleep(1100);
        const result = demo.allocate(goal, amountUsd, riskTolerance);
        setAllocation(result);
        setPhase("idle");
        return result;
      }
      try {
        const result = await postJson<AllocateResult>("/api/allocate", {
          goal,
          amountUsd,
          riskTolerance,
        });
        setAllocation(result);
        setPhase("idle");
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "The copilot couldn't build a plan.");
        setPhase("error");
        return null;
      }
    },
    [demo],
  );

  const invest = useCallback(
    async (alloc: Allocation, amountUsd: number, address: string) => {
      setError(null);
      // Demo: walk the placing phases on a timer, then a canned success.
      if (demo) {
        setPhase("planning");
        await sleep(900);
        setPhase("investing");
        await sleep(1500);
        setSuccess(demo.success(alloc, amountUsd));
        setPhase("done");
        return;
      }
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");

        // 1. Server signs the plan.
        setPhase("planning");
        const plan = await postJson<InvestPlanResult>("/api/invest-plan", {
          address,
          allocation: alloc,
          amountUsd,
        });

        const usdcTotal = BigInt(plan.usdcTotal);
        const legs = plan.legs.map((l) => ({
          router: l.router,
          tokenOut: l.tokenOut,
          usdcIn: BigInt(l.usdcIn),
          minOut: BigInt(l.minOut),
          swapData: l.swapData,
        }));

        // 2. Encode the two calls: approve USDC, then invest.
        const approveCall: Call = {
          to: USDC.address as `0x${string}`,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [plan.executor, usdcTotal],
          }),
        };
        const investCall: Call = {
          to: plan.executor,
          data: encodeFunctionData({
            abi: STAX_EXECUTOR_ABI,
            functionName: "investWithAI",
            args: [
              {
                planId: plan.plan.planId,
                recHash: plan.plan.recHash,
                riskScore: plan.plan.riskScore,
                agentId: BigInt(plan.plan.agentId),
              },
              {
                assessedRisk: plan.inference.assessedRisk,
                maxRisk: plan.inference.maxRisk,
                expiry: BigInt(plan.inference.expiry),
                signature: plan.inference.signature,
              },
              legs,
              usdcTotal,
            ],
          }),
        };

        // 3. Platform fee (gross − the net the server deployed) → treasury,
        //    batched first into the same sponsored UserOp.
        const grossRaw = BigInt(Math.round(amountUsd * 1_000_000));
        const feeRaw = grossRaw - usdcTotal;
        const feeCall: Call | null = feeRaw > BigInt(0)
          ? { to: USDC.address as `0x${string}`, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, feeRaw] }) }
          : null;

        // 4. Send the batched, sponsored UserOp.
        setPhase("investing");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const receipt = await sendSponsoredCalls(
          provider,
          feeCall ? [feeCall, approveCall, investCall] : [approveCall, investCall],
        );

        // 4. Build a success summary from the allocation (USD by weight).
        const holdings = alloc.allocations.map((a) => ({
          symbol: a.symbol,
          name: a.symbol,
          weightPct: a.weightPct,
          amountUsd: (amountUsd * a.weightPct) / 100,
        }));

        setSuccess({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          holdings,
          amountUsd,
          verification: {
            riskScore: plan.plan.riskScore,
            maxRisk: plan.inference.maxRisk,
            planId: plan.plan.planId,
            agentId: plan.plan.agentId,
            signature: plan.inference.signature,
          },
        });
        setPhase("done");
        refreshBalances(); // cash + holdings + activity refetch now, no manual refresh
      } catch (e) {
        setError(e instanceof Error ? e.message : "The investment didn't go through.");
        setPhase("error");
      }
    },
    [demo, activeWallet, refreshBalances],
  );

  return {
    phase,
    error,
    allocation,
    success,
    busy: phase === "thinking" || phase === "planning" || phase === "approving" || phase === "investing",
    allocate,
    invest,
    reset,
    clearError,
  };
}
