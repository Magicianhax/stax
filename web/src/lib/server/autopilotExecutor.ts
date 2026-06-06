import "server-only";

// Autopilot executor — the autonomous run. For one config it:
//   1. reads the smart account's USDC balance,
//   2. has Vera re-allocate against the saved goal,
//   3. gates on the user's HARD bounds (checkBounds) — nothing signs if it fails,
//   4. builds + signs the same investWithAI UserOp the app does (agent key signs
//      the risk inference; Privy server signs the owner sig), submits it gaslessly,
//   5. records the run (advances nextRunAt, accrues spentThisPeriod).
//
// It never exceeds the authorized amount, risk ceiling, or per-period cap.
import { createPublicClient, encodeFunctionData, http } from "viem";
import { mantle } from "viem/chains";
import { checkBounds, type AutopilotConfig } from "@/lib/autopilot";
import { recordRun, logRun } from "@/lib/server/autopilotStore";
import { buildAllocation } from "@/lib/server/allocate";
import { getServerSmartAccountClient } from "@/lib/server/privySmartAccount";
import { buildLegs, STAX_EXECUTOR } from "@/lib/legBuilder";
import { buildPlanId, recHash, signRiskInference } from "@/lib/eip712";
import { netOf, STAX_TREASURY } from "@/lib/fees";
import { ERC20_ABI, STAX_EXECUTOR_ABI } from "@/lib/abis";
import { USDC } from "@/lib/mantle";

const RPC_URL = process.env.NEXT_PUBLIC_MANTLE_RPC_URL || "https://rpc.mantle.xyz";
const AGENT_ID = BigInt(process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1");
const RISK_HEADROOM_BPS = 1500;
const RISK_CEILING_BPS = 10000;
const EXPIRY_SECONDS = 15 * 60;

const publicClient = createPublicClient({ chain: mantle, transport: http(RPC_URL) });

export interface RunResult {
  ok: boolean;
  txHash?: string;
  reason?: string;
}

/**
 * Run one autopilot config. `manual` = true for a user-triggered "Run now"
 * (counts against the current period); false = scheduled (starts a new period).
 */
export async function runAutopilot(
  cfg: AutopilotConfig,
  opts: { manual?: boolean; nowSeconds: number },
): Promise<RunResult> {
  const now = opts.nowSeconds;
  const working: AutopilotConfig = { ...cfg };
  // A scheduled run begins a fresh cadence period — reset the spend window.
  if (!opts.manual) working.spentThisPeriod = 0;

  // 1. Available cash in the smart account (USDC, 6dp).
  const bal = (await publicClient.readContract({
    address: USDC.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [working.smartAccount],
  })) as bigint;
  const availableUsd = Number(bal) / 1_000_000;

  // 2. Vera re-allocates for the saved goal.
  const allocation = await buildAllocation(working.goal, working.amountUsd);
  const assessedRiskBps = Math.max(0, Math.min(RISK_CEILING_BPS, Math.round(allocation.riskScore)));

  // 3. Hard bounds gate — the safety guarantee. Nothing below runs if this fails.
  const bounds = checkBounds(working, { availableUsd, assessedRiskBps });
  if (!bounds.ok) {
    await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "skipped", reason: bounds.reason });
    return { ok: false, reason: bounds.reason };
  }

  // 4. Build the plan exactly like /api/invest-plan (net deployed; fee skimmed).
  const grossTotal = BigInt(Math.round(working.amountUsd * 1_000_000));
  const usdcTotal = netOf(grossTotal);
  const feeRaw = grossTotal - usdcTotal;

  const { legs } = await buildLegs({ allocation, usdcTotal, client: publicClient, nowSeconds: now });
  if (legs.length === 0) {
    const reason = "Could not build any swap legs.";
    await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "error", reason });
    return { ok: false, reason };
  }

  const planId = buildPlanId(allocation, now);
  const maxRisk = Math.min(RISK_CEILING_BPS, assessedRiskBps + RISK_HEADROOM_BPS);
  const expiry = BigInt(now + EXPIRY_SECONDS);
  const signature = await signRiskInference({ planId, assessedRisk: assessedRiskBps, maxRisk, expiry });

  // 5. The same batched calls the app sends: [fee → treasury, approve, invest].
  const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];
  if (feeRaw > BigInt(0)) {
    calls.push({
      to: USDC.address as `0x${string}`,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, feeRaw] }),
    });
  }
  calls.push({
    to: USDC.address as `0x${string}`,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [STAX_EXECUTOR, usdcTotal] }),
  });
  calls.push({
    to: STAX_EXECUTOR as `0x${string}`,
    data: encodeFunctionData({
      abi: STAX_EXECUTOR_ABI,
      functionName: "investWithAI",
      args: [
        { planId, recHash: recHash(allocation), riskScore: assessedRiskBps, agentId: AGENT_ID },
        { assessedRisk: assessedRiskBps, maxRisk, expiry, signature },
        legs,
        usdcTotal,
      ],
    }),
  });

  // 6. Sign (Privy server owner sig) + submit gaslessly via Pimlico.
  let txHash: string;
  try {
    const { account, smartAccountClient } = await getServerSmartAccountClient(working.walletId, working.owner);
    const userOpHash = await smartAccountClient.sendUserOperation({ account, calls });
    const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash: userOpHash });
    if (!receipt.success) {
      const reason = `Run reverted (tx ${receipt.receipt.transactionHash}).`;
      await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "error", reason, txHash: receipt.receipt.transactionHash });
      return { ok: false, reason };
    }
    txHash = receipt.receipt.transactionHash;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Submission failed.";
    await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "error", reason });
    return { ok: false, reason };
  }

  // 7. Persist run accounting + audit log. The atomic claim already advanced
  //    next_run_at, so we only record the spend/count here.
  await recordRun(working.userId, {
    lastRunAt: now,
    runs: working.runs + 1,
    spentThisPeriod: working.spentThisPeriod + working.amountUsd,
  });
  const holdings = allocation.allocations.map((a) => ({
    symbol: a.symbol,
    weightPct: a.weightPct,
    amountUsd: Math.round(((working.amountUsd * a.weightPct) / 100) * 100) / 100,
  }));
  await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "success", txHash, holdings });

  return { ok: true, txHash };
}
