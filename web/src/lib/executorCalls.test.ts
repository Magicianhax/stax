// executorInvestCalls is the one encoder for the executor-path batch: useInvest sends what it
// returns, /api/invest-plan dry-runs exactly what it returns on BSC, and Autopilot signs what it
// returns. Pinned here byte for byte against the hand-written encoding the three callers used
// before, so Base and Mantle send exactly the same calls as they always have.
import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { ERC20_ABI, STAX_EXECUTOR_ABI } from "./abis";
import { getChain } from "./chains";
import { STAX_TREASURY } from "./fees";
import { executorInvestCalls } from "./executorCalls";

const PLAN = {
  planId: `0x${"11".repeat(32)}` as `0x${string}`,
  recHash: `0x${"22".repeat(32)}` as `0x${string}`,
  riskScore: 6000,
  agentId: BigInt(1),
};
const INFERENCE = { assessedRisk: 6000, maxRisk: 7500, expiry: BigInt(1_790_000_000), signature: `0x${"33".repeat(65)}` as `0x${string}` };
const LEGS = [
  {
    router: "0xb300000b72DEAEb607a12d5f54773D1C19c7028d" as `0x${string}`,
    tokenOut: "0xa9ee28c80f960b889dfbd1902055218cba016f75" as `0x${string}`,
    usdcIn: BigInt(6_000_000),
    minOut: BigInt(990),
    swapData: "0xdeadbeef" as `0x${string}`,
  },
];

function handWritten(chainKey: "base" | "mantle" | "bsc", usdcTotal: bigint, feeRaw: bigint) {
  const chain = getChain(chainKey);
  const usdc = chain.usdc.address;
  const executor = chain.contracts.executor;
  const fee = feeRaw > BigInt(0) ? [{ to: usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, feeRaw] }) }] : [];
  return [
    ...fee,
    { to: usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [executor, usdcTotal] }) },
    { to: executor, data: encodeFunctionData({ abi: STAX_EXECUTOR_ABI, functionName: "investWithAI", args: [PLAN, INFERENCE, LEGS, usdcTotal] }) },
  ];
}

describe("executorInvestCalls", () => {
  it.each(["base", "mantle", "bsc"] as const)("matches the hand-written [fee, approve, investWithAI] batch on %s", (key) => {
    const chain = getChain(key);
    const usdcTotal = BigInt(6_000_000);
    expect(executorInvestCalls({ chain, plan: PLAN, inference: INFERENCE, legs: LEGS, usdcTotal, feeRaw: BigInt(60_000) })).toEqual(
      handWritten(key, usdcTotal, BigInt(60_000)),
    );
  });

  it("leaves the fee call out when there is no fee (BSC, ADR-0007), so the batch is [approve, investWithAI]", () => {
    const chain = getChain("bsc");
    const usdcTotal = BigInt(6) * BigInt(10) ** BigInt(18);
    const calls = executorInvestCalls({ chain, plan: PLAN, inference: INFERENCE, legs: LEGS, usdcTotal, feeRaw: BigInt(0) });
    expect(calls).toEqual(handWritten("bsc", usdcTotal, BigInt(0)));
    expect(calls).toHaveLength(2);
  });

  it("approves the executor for exactly usdcTotal, never more", () => {
    const chain = getChain("bsc");
    const usdcTotal = BigInt("6000000000000000001");
    const [approve] = executorInvestCalls({ chain, plan: PLAN, inference: INFERENCE, legs: LEGS, usdcTotal, feeRaw: BigInt(0) });
    expect(approve.to).toBe(chain.usdc.address);
    expect(approve.data).toBe(encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [chain.contracts.executor, usdcTotal] }));
  });
});
