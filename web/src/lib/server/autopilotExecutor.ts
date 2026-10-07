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
// — no second leg-building path to keep in sync. A rule plan that calls for a SELL is refused
// instead of guessed at: `StaxExecutor.sol`'s only entry point pulls cash FROM the caller and
// forwards purchased tokens TO them — it has no function that pulls a token back and sells it —
// so a sell can never actually execute on this chain. rulesEngine.ts already keeps
// rebalance/safety_switch/mix_keeper buy-only for exactly this reason (its own header has the
// detail), so this refusal should be unreachable today; it stays as the last-resort safety net in
// case a future rule type, or a bug in that buy-only conversion, ever hands this a sell anyway.
import { encodeFunctionData } from "viem";
import { checkBounds, type AutopilotConfig } from "@/lib/autopilot";
import { getChain, assetBySymbol } from "@/lib/chains";
import type { StaxChain } from "@/lib/chains/types";
import type { Allocation } from "@/lib/allocation-schema";
import { riskScoreFor } from "@/lib/baskets";
import { resolveVenueAddress } from "@/lib/venues";
import { serverClient } from "@/lib/server/chain";
import { recordRun, logRun, pauseAutopilot } from "@/lib/server/autopilotStore";
import { planAutopilotRun } from "@/lib/server/autopilotPlan";
import { AllocationRefusal } from "@/lib/server/bscPlan";
import { BinanceLegRefusal } from "@/lib/server/binanceLegs";
import { fetchPrivyEmbeddedWallets } from "@/lib/server/privyAuth";
import { ownsEmbeddedWallet } from "@/lib/server/privyWallets";
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
  /**
   * False for a "skipped" outcome — a real, decided state (not deployed yet, waiting on
   * holdings, over the risk ceiling, cap reached) rather than a transient fault. The cron's
   * retry loop (review finding #4) used to retry every failure identically, which meant a BSC
   * config hit `runAutopilot` 3x/day with 4s+12s sleeps for a "not deployed" skip that could
   * never resolve inside the same invocation — with ~18 users that alone could blow the shared
   * 300s Vercel Hobby budget and starve other chains' runs in the same tick. Undefined (the
   * default) leaves the existing text-based `isPermanent` check in charge, same as before.
   */
  retryable?: boolean;
  /**
   * A successful run that found nothing to do (a rule whose condition wasn't met): the plain
   * sentence the Activity row carries, so "Run now" can say it instead of "Vera invested for you".
   */
  receipt?: string;
}

/**
 * Words for a refusal Stax's own planning rules made (the market is closed, the amount is under
 * Binance's $6 per holding). A decided, honest state, not a fault: logged as "skipped" so the
 * person sees it in Activity, and never retried inside the same cron tick. Anything else is a
 * real fault and is rethrown. A "route" refusal's words are for logs, never a screen.
 */
function planningRefusalReason(err: unknown): string | null {
  if (err instanceof AllocationRefusal) return err.message;
  if (err instanceof BinanceLegRefusal) {
    if (err.code === "min_trade") {
      return "This run's amount is too small to give every holding Binance's $6 minimum. Raise the amount in Autopilot.";
    }
    if (err.code === "route") return null;
    return err.message;
  }
  return null;
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

  // The server signs for (walletId, owner). The route checked that pair belongs to this user when
  // it was saved, but rows saved before that check could pair someone else's wallet id with this
  // user's account, so re-check at run time. Fail closed: any doubt means nothing signs.
  try {
    const wallets = await fetchPrivyEmbeddedWallets(working.userId);
    if (!ownsEmbeddedWallet(wallets, working.walletId, working.owner)) {
      const reason = "Autopilot is paused because its wallet isn't one of yours. Set it up again in Autopilot.";
      console.error(`[autopilot] wallet/owner mismatch for ${working.id}; pausing`);
      await log({ status: "error", reason });
      await pauseAutopilot(working.id);
      return { ok: false, reason, retryable: false };
    }
  } catch (err) {
    // Couldn't check (Privy down): skip this run, keep the schedule, try again next tick.
    console.error("[autopilot] couldn't verify wallet ownership:", err instanceof Error ? err.message : err);
    const reason = "We couldn't check your wallet just now. Autopilot will try again on its next run.";
    await log({ status: "skipped", reason });
    return { ok: false, reason, retryable: false };
  }

  if (!chain.contracts.deployed) {
    const reason = `Stax is not deployed on ${chain.name} yet.`;
    await log({ status: "skipped", reason });
    return { ok: false, reason, retryable: false };
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
  let plan: Awaited<ReturnType<typeof planAutopilotRun>>;
  try {
    plan = await planAutopilotRun(working, chain, now);
  } catch (err) {
    const reason = planningRefusalReason(err);
    if (!reason) throw err;
    await log({ status: "skipped", reason });
    return { ok: false, reason, retryable: false };
  }

  let allocation: Allocation;
  let spendUsd: number;
  let assessedRiskBps = 0;
  let receiptOverride: string | undefined;

  if ("kind" in plan) {
    if (!plan.ok) {
      await log({ status: plan.status, reason: plan.reason });
      if (plan.pause) await pauseAutopilot(working.id);
      // A "skipped" rule plan (waiting on holdings, market closed, nothing to fix) is a decided,
      // honest state, not a fault worth retrying 2 more times in the same tick — see RunResult's
      // header.
      return { ok: false, reason: plan.reason, retryable: plan.status === "skipped" ? false : undefined };
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
      return { ok: true, receipt: plan.receipt };
    }
    spendUsd = plan.intents.reduce((s, i) => s + i.usd, 0);
    const weights = plan.intents.map((i) => ({ symbol: i.symbol, weightPct: (i.usd / spendUsd) * 100 }));
    // Score the rule's own allocation the same way a basket does (lib/baskets.ts's
    // riskScoreFor, blended bps by asset tier) — this used to be hard-coded to 0, which both
    // let a rule skip the user's risk ceiling in checkBounds below and signed a fabricated
    // "zero risk" on-chain inference for whatever it actually bought (review finding #1).
    assessedRiskBps = riskScoreFor(chain, weights);
    allocation = {
      summary: plan.receipt,
      rationale: plan.receipt,
      riskScore: assessedRiskBps,
      allocations: weights.map((w, idx) => {
        const intent = plan.intents[idx];
        // Carries the venue a buy_discount intent actually priced (review finding #2) onto the
        // allocation entry, same shape Vera's own BSC allocations already use (allocation-schema
        // ts's `venue`/`address`). rulesEngine.ts only ever hands back the asset's own platform
        // here (anything else is refused before this point), so this is display-accurate, not
        // yet load-bearing for buildLegs below.
        const asset = intent.platform ? assetBySymbol(chain, intent.symbol) : undefined;
        const resolved = asset ? resolveVenueAddress(chain, asset, intent.platform) : null;
        return {
          symbol: w.symbol,
          weightPct: w.weightPct,
          reason: intent.reason,
          ...(resolved ? { venue: resolved.platform, address: resolved.address } : {}),
        };
      }),
    };
    receiptOverride = plan.receipt;
  } else {
    if (plan.basket) basketMeta = { basketId: plan.basket.id, basketName: plan.basket.name };
    if (!plan.ok) {
      await log({ assessedRiskBps: plan.assessedRiskBps, status: plan.status, reason: plan.reason });
      if (plan.pause) await pauseAutopilot(working.id);
      return { ok: false, reason: plan.reason, retryable: plan.status === "skipped" ? false : undefined };
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
    return { ok: false, reason: bounds.reason, retryable: false };
  }

  // 4. Build the plan exactly like /api/invest-plan (net deployed; fee skimmed — BSC skims none).
  const grossTotal = usdToRaw(chain, spendUsd);
  const usdcTotal = netOf(grossTotal, chain.key);
  const feeRaw = grossTotal - usdcTotal;

  let legs: Awaited<ReturnType<typeof buildLegs>>["legs"];
  try {
    ({ legs } = await buildLegs({ chain, allocation, usdcTotal, client, nowSeconds: now }));
  } catch (err) {
    const reason = planningRefusalReason(err);
    if (!reason) throw err;
    await log({ assessedRiskBps, status: "skipped", reason, amountUsd: spendUsd });
    return { ok: false, reason, retryable: false };
  }
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
