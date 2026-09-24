"use client";

// useInvest — the heart of the Lite happy-path, on the active chain.
//
//   allocate(goal, amount)  -> AI builds an allocation (POST /api/allocate)
//   invest(allocation, ...) -> server signs a plan (POST /api/invest-plan), then we send
//                              ONE batched gasless UserOp. Two shapes, chosen by the response:
//                                executor (Base/Mantle): [ fee -> treasury,
//                                  USDC.approve(executor, total),
//                                  executor.investWithAI(plan, inf, legs, total) ]
//                                direct (ADR-0005, BSC before the executor is deployed): the
//                                  response's own `calls` array, sent verbatim after
//                                  `assertExecCallsAreSafe` checks every recipient — see
//                                  lib/execution.ts.
//
// All signing of the risk inference happens server-side with the agent key;
// the browser only relays the already-signed plan to the smart account. The
// `x-stax-chain` header (authedFetch) tells the server which network to plan
// for. `chain.contracts.deployed` only gates the executor shape: a direct-path
// response carries its own calls and needs no deployed executor to send them.
import { useCallback, useState } from "react";
import { encodeFunctionData } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls, type Call } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { ERC20_ABI, STAX_EXECUTOR_ABI } from "@/lib/abis";
import { useChain } from "@/lib/chains/active";
import { assertExecCallsAreSafe } from "@/lib/execution";
import { STAX_TREASURY } from "@/lib/fees";
import { usdToRaw } from "@/lib/units";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { authedFetch } from "@/lib/authedFetch";
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
  const res = await authedFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  const chain = useChain();
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

  // Calm, honest stop when the chain's executor isn't live yet (Base pre-deploy).
  const notLiveMessage = `${chain.name} is being switched on. Investing there opens soon — you can switch networks in Settings meanwhile.`;

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
      if (!chain.contracts.deployed) {
        setError(notLiveMessage);
        setPhase("error");
        return null;
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
    [demo, chain, notLiveMessage],
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

        // 1. Server signs the plan for the active chain. `chain.contracts.deployed` gates
        //    only the executor shape below — a direct-path response (`plan.calls`) needs no
        //    deployed executor, so we always ask before deciding which shape to send.
        setPhase("planning");
        const plan = await postJson<InvestPlanResult>("/api/invest-plan", {
          address,
          allocation: alloc,
          amountUsd,
        });
        // Never relay a plan built for another network / executor.
        if (plan.chain !== chain.key) {
          throw new Error("That plan was built for a different network. Please try again.");
        }

        let calls: Call[];
        let verification: InvestSuccess["verification"];
        if (plan.calls) {
          // 2a. Direct smart-account path (ADR-0005): no executor contract stands between
          //     these calls and the wallet, so every recipient is checked before anything is
          //     signed. Sent verbatim, in order, as one sponsored user op — atomic, so a
          //     basket can never half-execute.
          calls = assertExecCallsAreSafe(chain, plan.calls).map((c) => ({
            to: c.to,
            data: c.data,
            ...(c.value !== undefined ? { value: BigInt(c.value) } : {}),
          }));
          // No on-chain risk-verification step on this path — nothing to show.
        } else {
          // 2b. Executor path (Base/Mantle today): encode approve + investWithAI.
          if (!chain.contracts.deployed) {
            setError(notLiveMessage);
            setPhase("error");
            return;
          }
          const executor = chain.contracts.executor;
          if (plan.executor.toLowerCase() !== executor.toLowerCase()) {
            throw new Error("That plan doesn't match this network. Please try again.");
          }

          const usdcTotal = BigInt(plan.usdcTotal);
          const legs = plan.legs.map((l) => ({
            router: l.router,
            tokenOut: l.tokenOut,
            usdcIn: BigInt(l.usdcIn),
            minOut: BigInt(l.minOut),
            swapData: l.swapData,
          }));

          const usdc = chain.usdc.address;
          const approveCall: Call = {
            to: usdc,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "approve",
              args: [executor, usdcTotal],
            }),
          };
          const investCall: Call = {
            to: executor,
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

          // Platform fee (gross − the net the server deployed) → treasury, batched first
          // into the same sponsored UserOp. (Zero on any chain where the server deploys the
          // full gross amount, e.g. BSC once the executor is live — ADR-0007.)
          const grossRaw = usdToRaw(chain, amountUsd);
          const feeRaw = grossRaw - usdcTotal;
          const feeCall: Call | null = feeRaw > BigInt(0)
            ? { to: usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, feeRaw] }) }
            : null;

          calls = feeCall ? [feeCall, approveCall, investCall] : [approveCall, investCall];
          verification = {
            riskScore: plan.plan.riskScore,
            maxRisk: plan.inference.maxRisk,
            planId: plan.plan.planId,
            agentId: plan.plan.agentId,
            signature: plan.inference.signature,
          };
        }

        // 3. Send the batched, sponsored UserOp on the active chain.
        setPhase("investing");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const receipt = await sendSponsoredCalls(provider, calls, chain);

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
          ...(verification ? { verification } : {}),
        });
        setPhase("done");
        refreshBalances(); // cash + holdings + activity refetch now, no manual refresh
      } catch (e) {
        setError(e instanceof Error ? e.message : "The investment didn't go through.");
        setPhase("error");
      }
    },
    [demo, chain, activeWallet, refreshBalances, notLiveMessage],
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
