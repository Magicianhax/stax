import "server-only";

// Autopilot executor — the autonomous run. For one config it:
//   1. reads the smart account's USDC balance on the config's chain,
//   2. plans the buy (autopilotPlan.ts's planAutopilotRun): a fixed basket's weights, Vera's
//      allocation for the saved goal, OR — when the goal carries an encoded rule (lib/rules.ts)
//      — the rule engine's buy/sell intents. A basket above the risk ceiling is refused there.
//   3. gates on the user's HARD bounds (checkBounds) — nothing signs if it fails,
//   4. builds + signs the same investWithAI UserOp the app does (agent key signs
//      the risk inference for that chain; Privy server signs the owner sig),
//      submits it gaslessly via Pimlico on that chain,
//   5. records the run (advances nextRunAt, accrues spentThisPeriod).
//
// It never exceeds the authorized amount, risk ceiling, or per-period cap.
//
// Rule runs (step 2's third case): a rule's buy intents are turned into an Allocation right here
// and handed to the exact same buildLegs/sign/submit pipeline a goal or basket plan already uses
// — no second leg-building path to keep in sync. A rule that also calls for a SELL (rebalance,
// safety_switch, mix_keeper trimming an overweight holding) is refused instead of guessed at:
// pricing a sell needs the account's live per-asset holdings, which is a Wallet API integration
// this stream doesn't own (rulesEngine.ts's header has the detail; wiringNeeded lists it).
import { encodeFunctionData } from "viem";
import { checkBounds, type AutopilotConfig } from "@/lib/autopilot";
import { getChain } from "@/lib/chains";
import type { StaxChain } from "@/lib/chains/types";
import type { Allocation } from "@/lib/allocation-schema";
import { serverClient } from "@/lib/server/chain";
import { recordRun, logRun, pauseAutopilot } from "@/lib/server/autopilotStore";
import { planAutopilotRun } from "@/lib/server/autopilotPlan";
import { getServerSmartAccountClient } from "@/lib/server/privySmartAccount";
import { buildLegs } from "@/lib/legBuilder";
import { buildPlanId, recHash, signRiskInference } from "@/lib/eip712";
import { netOf, STAX_TREASURY } from "@/lib/fees";
import { rawToUsd, usdToRaw } from "@/lib/units";
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
 * new period). `chain` is injectable for tests; every real caller uses the default.
 */
export async function runAutopilot(
  cfg: AutopilotConfig,
  opts: { manual?: boolean; nowSeconds: number },
  chain: StaxChain = getChain(cfg.chain),
): Promise<RunResult> {
  const now = opts.nowSeconds;
  const working: AutopilotConfig = { ...cfg, chain: chain.key };
  // A scheduled run begins a fresh cadence period — reset the spend window.
  if (!opts.manual) working.spentThisPeriod = 0;

  // Every log line for a basket autopilot carries the basket, even when it could not be resolved.
  let basketMeta: { basketId: string; basketName?: string } | undefined = working.basketId
    ? { basketId: working.basketId }
    : undefined;
  const log = (entry: Omit<Parameters<typeof logRun>[0], "userId" | "ranAt" | "chain" | "amountUsd"> & { amountUsd?: number }) =>
    logRun({ userId: working.userId, chain: chain.key, ranAt: now, amountUsd: working.amountUsd, ...basketMeta, ...entry });

  if (!chain.contracts.deployed) {
    const reason = `Stax is not deployed on ${chain.name} yet.`;
    await log({ status: "skipped", reason });
    return { ok: false, reason };
  }

  const client = serverClient(chain);
  const executor = chain.contracts.executor;
  const usdc = chain.usdc.address;

  // 1. Available cash in the smart account (this chain's cash asset, its own decimals).
  const bal = (await client.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [working.smartAccount],
  })) as bigint;
  const availableUsd = rawToUsd(chain, bal);

  // 2. The plan: the basket's fixed weights, Vera's allocation for the saved goal, or a rule's
  //    buy/sell intents. Whichever it is, it resolves to one Allocation + spend amount below —
  //    steps 3 onward never need to know which kind of plan produced them.
  const plan = await planAutopilotRun(working, chain, now);

  let allocation: Allocation;
  let spendUsd: number;
  let assessedRiskBps = 0;
  let receiptOverride: string | undefined;

  if ("kind" in plan) {
    if (!plan.ok) {
      await log({ status: plan.status, reason: plan.reason });
      if (plan.pause) await pauseAutopilot(working.id);
      return { ok: false, reason: plan.reason };
    }
    if (plan.intents.some((i) => i.action === "sell")) {
      const reason = "Selling existing holdings for this rule isn't wired up yet.";
      await log({ status: "error", reason });
      return { ok: false, reason };
    }
    if (plan.intents.length === 0) {
      // A real, successful check that found nothing to do — not a skip (Vera didn't fail to
      // act, there was nothing to fix) and not an error.
      await log({ status: "success", reason: plan.receipt, amountUsd: 0 });
      return { ok: true };
    }
    spendUsd = plan.intents.reduce((s, i) => s + i.usd, 0);
    allocation = {
      summary: plan.receipt,
      rationale: plan.receipt,
      riskScore: 0,
      allocations: plan.intents.map((i) => ({ symbol: i.symbol, weightPct: (i.usd / spendUsd) * 100, reason: i.reason })),
    };
    receiptOverride = plan.receipt;
  } else {
    if (plan.basket) basketMeta = { basketId: plan.basket.id, basketName: plan.basket.name };
    if (!plan.ok) {
      await log({ assessedRiskBps: plan.assessedRiskBps, status: plan.status, reason: plan.reason });
      if (plan.pause) await pauseAutopilot(working.id);
      return { ok: false, reason: plan.reason };
    }
    allocation = plan.allocation;
    assessedRiskBps = plan.assessedRiskBps;
    spendUsd = working.amountUsd;
  }

  // 3. Hard bounds gate — the safety guarantee. Nothing below runs if this fails. A rule's own
  //    spend (its intents' total, not necessarily the full period amount) is what's checked
  //    against the cap and the balance.
  const bounds = checkBounds({ ...working, amountUsd: spendUsd }, { availableUsd, assessedRiskBps });
  if (!bounds.ok) {
    await log({ assessedRiskBps, status: "skipped", reason: bounds.reason, amountUsd: spendUsd });
    return { ok: false, reason: bounds.reason };
  }

  // 4. Build the plan exactly like /api/invest-plan (net deployed; fee skimmed — BSC skims none).
  const grossTotal = usdToRaw(chain, spendUsd);
  const usdcTotal = netOf(grossTotal, chain.key);
  const feeRaw = grossTotal - usdcTotal;

  const { legs } = await buildLegs({ chain, allocation, usdcTotal, client, nowSeconds: now });
  if (legs.length === 0) {
    const reason = "Could not build any swap legs.";
    await log({ assessedRiskBps, status: "error", reason, amountUsd: spendUsd });
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
      await log({ assessedRiskBps, status: "error", reason, txHash: receipt.receipt.transactionHash, amountUsd: spendUsd });
      return { ok: false, reason };
    }
    txHash = receipt.receipt.transactionHash;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Submission failed.";
    await log({ assessedRiskBps, status: "error", reason, amountUsd: spendUsd });
    return { ok: false, reason };
  }

  // 7. Persist run accounting + audit log. The atomic claim already advanced
  //    next_run_at, so we only record the spend/count here.
  await recordRun(working.userId, {
    lastRunAt: now,
    runs: working.runs + 1,
    spentThisPeriod: working.spentThisPeriod + spendUsd,
  });
  const holdings = allocation.allocations.map((a) => ({
    symbol: a.symbol,
    weightPct: a.weightPct,
    amountUsd: Math.round(((spendUsd * a.weightPct) / 100) * 100) / 100,
  }));
  await log({ assessedRiskBps, status: "success", txHash, holdings, amountUsd: spendUsd, reason: receiptOverride });

  return { ok: true, txHash };
}
