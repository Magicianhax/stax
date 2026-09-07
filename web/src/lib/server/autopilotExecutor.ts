import "server-only";

// Autopilot executor — the autonomous run. For one config it:
//   1. reads the smart account's USDC balance on the config's chain,
//   2. plans the buy (autopilotPlan.ts): a fixed basket's weights when the
//      autopilot targets a basket, else Vera re-allocates against the saved goal
//      (that chain's universe). A basket above the risk ceiling is refused there.
//   3. gates on the user's HARD bounds (checkBounds) — nothing signs if it fails,
//   4. builds + signs the same investWithAI UserOp the app does (agent key signs
//      the risk inference for that chain; Privy server signs the owner sig),
//      submits it gaslessly via Pimlico on that chain,
//   5. records the run (advances nextRunAt, accrues spentThisPeriod).
//
// It never exceeds the authorized amount, risk ceiling, or per-period cap.
import { encodeFunctionData } from "viem";
import { checkBounds, type AutopilotConfig } from "@/lib/autopilot";
import { getChain } from "@/lib/chains";
import { serverClient } from "@/lib/server/chain";
import { recordRun, logRun, pauseAutopilot } from "@/lib/server/autopilotStore";
import { planForAutopilot } from "@/lib/server/autopilotPlan";
import { getServerSmartAccountClient } from "@/lib/server/privySmartAccount";
import { buildLegs } from "@/lib/legBuilder";
import { buildPlanId, recHash, signRiskInference } from "@/lib/eip712";
import { netOf, STAX_TREASURY } from "@/lib/fees";
import { ERC20_ABI, STAX_EXECUTOR_ABI } from "@/lib/abis";

const RISK_HEADROOM_BPS = 1500;
const RISK_CEILING_BPS = 10000;
const EXPIRY_SECONDS = 15 * 60;

export interface RunResult {
  ok: boolean;
  txHash?: string;
  reason?: string;
}

/**
 * Run one autopilot config on its chain. `manual` = true for a user-triggered
 * "Run now" (counts against the current period); false = scheduled (starts a
 * new period).
 */
export async function runAutopilot(
  cfg: AutopilotConfig,
  opts: { manual?: boolean; nowSeconds: number },
): Promise<RunResult> {
  const now = opts.nowSeconds;
  const chain = getChain(cfg.chain);
  const working: AutopilotConfig = { ...cfg, chain: chain.key };
  // A scheduled run begins a fresh cadence period — reset the spend window.
  if (!opts.manual) working.spentThisPeriod = 0;

  // Every log line for a basket autopilot carries the basket, even when it could not be resolved.
  let basketMeta: { basketId: string; basketName?: string } | undefined = working.basketId
    ? { basketId: working.basketId }
    : undefined;
  const log = (entry: Omit<Parameters<typeof logRun>[0], "userId" | "ranAt" | "amountUsd" | "chain">) =>
    logRun({ userId: working.userId, chain: chain.key, ranAt: now, amountUsd: working.amountUsd, ...basketMeta, ...entry });

  if (!chain.contracts.deployed) {
    const reason = `Stax is not deployed on ${chain.name} yet.`;
    await log({ status: "skipped", reason });
    return { ok: false, reason };
  }

  const client = serverClient(chain);
  const executor = chain.contracts.executor;
  const usdc = chain.usdc.address;

  // 1. Available cash in the smart account (USDC, 6dp).
  const bal = (await client.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [working.smartAccount],
  })) as bigint;
  const availableUsd = Number(bal) / 10 ** chain.usdc.decimals;

  // 2. The plan: the basket's fixed weights, or Vera's allocation for the saved goal.
  const plan = await planForAutopilot(working, chain);
  if (plan.basket) basketMeta = { basketId: plan.basket.id, basketName: plan.basket.name };
  if (!plan.ok) {
    await log({ assessedRiskBps: plan.assessedRiskBps, status: plan.status, reason: plan.reason });
    if (plan.pause) await pauseAutopilot(working.id);
    return { ok: false, reason: plan.reason };
  }
  const { allocation, assessedRiskBps } = plan;

  // 3. Hard bounds gate — the safety guarantee. Nothing below runs if this fails.
  const bounds = checkBounds(working, { availableUsd, assessedRiskBps });
  if (!bounds.ok) {
    await log({ assessedRiskBps, status: "skipped", reason: bounds.reason });
    return { ok: false, reason: bounds.reason };
  }

  // 4. Build the plan exactly like /api/invest-plan (net deployed; fee skimmed).
  const grossTotal = BigInt(Math.round(working.amountUsd * 1_000_000));
  const usdcTotal = netOf(grossTotal);
  const feeRaw = grossTotal - usdcTotal;

  const { legs } = await buildLegs({ chain, allocation, usdcTotal, client, nowSeconds: now });
  if (legs.length === 0) {
    const reason = "Could not build any swap legs.";
    await log({ assessedRiskBps, status: "error", reason });
    return { ok: false, reason };
  }

  const planId = buildPlanId(allocation, now);
  const maxRisk = Math.min(RISK_CEILING_BPS, assessedRiskBps + RISK_HEADROOM_BPS);
  const expiry = BigInt(now + EXPIRY_SECONDS);
  const signature = await signRiskInference(chain, { planId, assessedRisk: assessedRiskBps, maxRisk, expiry });

  // 5. The same batched calls the app sends: [fee → treasury, approve, invest].
  const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];
  if (feeRaw > BigInt(0)) {
    calls.push({
      to: usdc,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, feeRaw] }),
    });
  }
  calls.push({
    to: usdc,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [executor, usdcTotal] }),
  });
  calls.push({
    to: executor,
    data: encodeFunctionData({
      abi: STAX_EXECUTOR_ABI,
      functionName: "investWithAI",
      args: [
        { planId, recHash: recHash(allocation), riskScore: assessedRiskBps, agentId: chain.contracts.agentId },
        { assessedRisk: assessedRiskBps, maxRisk, expiry, signature },
        legs,
        usdcTotal,
      ],
    }),
  });

  // 6. Sign (Privy server owner sig) + submit gaslessly via Pimlico on this chain.
  let txHash: string;
  try {
    const { account, smartAccountClient } = await getServerSmartAccountClient(chain, working.walletId, working.owner);
    const userOpHash = await smartAccountClient.sendUserOperation({ account, calls });
    const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash: userOpHash });
    if (!receipt.success) {
      const reason = `Run reverted (tx ${receipt.receipt.transactionHash}).`;
      await log({ assessedRiskBps, status: "error", reason, txHash: receipt.receipt.transactionHash });
      return { ok: false, reason };
    }
    txHash = receipt.receipt.transactionHash;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Submission failed.";
    await log({ assessedRiskBps, status: "error", reason });
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
  await log({ assessedRiskBps, status: "success", txHash, holdings });

  return { ok: true, txHash };
}
