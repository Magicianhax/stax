import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { AllocationSchema } from "@/lib/allocation-schema";
import { isRoutable } from "@/lib/chains";
import { riskScoreFor } from "@/lib/baskets";
import { buildLegs } from "@/lib/legBuilder";
import { buildPlanId, recHash, signRiskInference } from "@/lib/eip712";
import { netOf } from "@/lib/fees";
import { usdToRaw } from "@/lib/units";
import { chainFromRequest, serverClient } from "@/lib/server/chain";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { getSmartAccount } from "@/lib/server/users";
import { getBinanceWeb3 } from "@/lib/server/binance";
import { bscCatalogSnapshot } from "@/lib/server/rwaCatalog";
import { buildBscInvestLegs, notEnoughCashMessage, PLAN_MIN_LEG_MESSAGE } from "@/lib/server/bscPlan";
import { loadBscMarket } from "@/lib/server/bscMarket";
import { executorInvestCalls } from "@/lib/executorCalls";
import { assetSymbolForToken } from "@/lib/venues";
import type { StaxChain } from "@/lib/chains/types";
import { ERC20_ABI } from "@/lib/abis";
import { rawToUsd } from "@/lib/units";
import { BinanceLegError, BinanceLegRefusal } from "@/lib/server/binanceLegs";
import { decodeApproveAmount, dryRunBscExecutorBatch, dryRunBscSwap, pairLegCalls } from "@/lib/server/dryRun";
import { unauthorized, badRequest, tooManyRequests, serverError, jsonError } from "@/lib/server/respond";
import type { ExecCall } from "@/lib/execution";
import type { DryRun } from "@/lib/dryRun";
import type { InvestPlanResult } from "@/lib/invest-types";

// Signs with the agent key + reads chain state — never cache.
export const dynamic = "force-dynamic";

// M-1: hard upper bound on a single plan so a caller can't get the agent to sign
// an absurd approval. 6-figure cap is well above any realistic tap-to-invest.
const MAX_AMOUNT_USD = 1_000_000;

const RISK_HEADROOM_BPS = 1500; // how far above assessed risk we let maxRisk sit
const RISK_CEILING_BPS = 10000;
const EXPIRY_SECONDS = 15 * 60;

const InvestPlanRequestSchema = z.object({
  address: z.string().refine((a) => isAddress(a), "Invalid wallet address."),
  allocation: AllocationSchema,
  amountUsd: z.number().positive().max(MAX_AMOUNT_USD),
});

/**
 * BNB Chain plans (either path) are built for, and dry-run from, the caller's own registered
 * smart account, and refused up front when it holds less cash than the plan spends: a plan for
 * more than the account holds can only fail at Binance's check or in the bundler with words the
 * person can't act on. If the balance can't be read, don't block: the chain still has the final
 * word. Returns the account to plan for, or the refusal to send back.
 */
async function bscAccountGate(
  userId: string,
  chain: StaxChain,
  address: string,
  grossTotal: bigint,
): Promise<{ taker: `0x${string}` } | { refusal: Response }> {
  const account = await getSmartAccount(userId, chain.key);
  if (!account) {
    return { refusal: badRequest("No account found for this network. Please sign in again.") };
  }
  if (account.address.toLowerCase() !== address.toLowerCase()) {
    return { refusal: jsonError(403, "Plan must be for your own account.") };
  }
  const taker = account.address as `0x${string}`;
  try {
    const cash = (await serverClient(chain).readContract({
      address: chain.usdc.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [taker],
    })) as bigint;
    if (cash < grossTotal) return { refusal: badRequest(notEnoughCashMessage(rawToUsd(chain, cash))) };
  } catch (err) {
    console.warn("[invest-plan] couldn't read the cash balance:", err instanceof Error ? err.message : err);
  }
  return { taker };
}

/**
 * A BNB Chain leg Stax or Binance refused, as the response the plan screen shows: any leg failing
 * fails the whole plan, naming that leg, never a partial batch. Null for anything else (a real
 * fault, which goes through serverError). Base/Mantle legs never throw these.
 */
function legRefusalResponse(err: unknown): Response | null {
  if (err instanceof BinanceLegRefusal) {
    // A "route" refusal's words are for the log, never Vera's plan screen (P0 #3).
    if (err.code === "route") {
      console.error("[invest-plan]", err.message);
      return jsonError(502, "We couldn't get a price just now. Try again in a moment.");
    }
    // The leg-level "enter $6 or more" copy points at an amount field a plan doesn't have.
    return badRequest(err.code === "min_trade" ? PLAN_MIN_LEG_MESSAGE : err.message);
  }
  if (err instanceof BinanceLegError) {
    console.error("[invest-plan]", err.message);
    return jsonError(502, "We couldn't get a price just now. Try again in a moment.");
  }
  return null;
}

export async function POST(req: NextRequest) {
  // C-2: only a signed-in user can have the agent sign a plan.
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  // Private beta: only approved users may spend (no-op while NEXT_PUBLIC_PRIVATE_BETA is off).
  const gate = await requireApproved(user);
  if (gate) return gate;

  // M-5: cap signing requests per user.
  const limit = await rateLimit(`invest-plan:${user.userId}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  // Which chain the plan is for (x-stax-chain header / ?chain=; Base default).
  const chain = chainFromRequest(req);
  // The executor isn't the only way to invest: a chain with a Binance router but no deployed
  // executor (BSC before 2026-10-07, ADR-0005) goes through the direct smart-account path below
  // instead. Any other undeployed chain (Base pre-deploy) still has nothing to fall back to.
  if (!chain.contracts.deployed && !chain.routers.binance) {
    return jsonError(503, `Stax is not deployed on ${chain.name} yet`);
  }

  let body: z.infer<typeof InvestPlanRequestSchema>;
  try {
    body = InvestPlanRequestSchema.parse(await req.json());
  } catch {
    // M-4: never echo input back; a generic message avoids reflecting submitted data.
    return badRequest("Invalid request body.");
  }

  try {
    const { allocation, amountUsd, address } = body;

    // Baskets / shared links: every holding must be buyable on this chain. Name the
    // offenders (they're our own tickers, not user input echoed back).
    const notRoutable = allocation.allocations
      .map((a) => a.symbol)
      .filter((s) => !isRoutable(chain, s));
    if (notRoutable.length > 0) {
      return badRequest(`Not buyable on ${chain.name} yet: ${[...new Set(notRoutable)].join(", ")}.`);
    }

    // Dollars -> raw cash units through units.ts, never a float times 10**decimals by hand —
    // BSC's USDT is 18dp, and that used to be a 6dp-only formula (M-11 / Review Focus #2).
    // The platform fee is skimmed by the client (a batched cash transfer to the treasury, zero
    // on BSC — ADR-0007), so we deploy the NET into assets — legs are built against the net so
    // they sum correctly and BSC deploys the full amount.
    const grossTotal = usdToRaw(chain, amountUsd);
    if (grossTotal <= BigInt(0)) {
      return badRequest("Amount too small.");
    }
    const usdcTotal = netOf(grossTotal, chain.key);

    // Clock read at request time (allowed here) — drives planId nonce + expiry, and (BSC) the
    // market-hours checks below.
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    if (!chain.contracts.deployed) {
      // Direct smart-account path (ADR-0005): no executor to route through, so every leg is
      // built straight against the Binance aggregator and returned as calls for the client to
      // sign verbatim (assertExecCallsAreSafe checks every recipient client-side). The taker
      // must be the caller's own registered smart account — there is no executor in between to
      // hold funds, so signing for anyone else's account is never on the table.
      const gate = await bscAccountGate(user.userId, chain, address, grossTotal);
      if ("refusal" in gate) return gate.refusal;
      const { taker } = gate;

      let calls: ExecCall[];
      let dryRuns: DryRun[] = [];

      try {
        const [catalog, tokens] = await Promise.all([bscCatalogSnapshot(nowMs), getBinanceWeb3().rwaTokens()]);
        const builtLegs = await buildBscInvestLegs({
          chain,
          allocation,
          usdcTotal,
          taker,
          catalog: catalog.tickers,
          tokens,
          nowMs,
        });
        calls = builtLegs.flatMap((l) => l.calls);

        // A Binance dry run per leg, right before these calls go back for signing. Each built leg
        // is exactly [approve, swap] (directCallsForLeg) and carries the token it actually buys
        // (a stock's issuer token or the coin's own address), so the check simulates precisely what
        // was built, never a token looked up again afterwards. dryRunBscSwap simulates the whole
        // [approve, swap] pair atomically (see its own comment), so it spends a Binance call for
        // every leg once this account has sent its first on-chain trade — never zero calls just
        // because a leg's own token hasn't been approved before. A brand-new account's very
        // first-ever basket buy still spends zero (no deployed bytecode yet to simulate against);
        // a multi-leg TOP-UP basket can spend up to one call per leg, sharing the same 5-per-window
        // budget as everything else on this key — worth revisiting as one whole-basket simulate
        // call if that budget ever gets tight (see openIssues in the dry-run stream's wave 5 report).
        dryRuns = await Promise.all(
          builtLegs.map(async (built) => {
            const [pair] = pairLegCalls(built.calls);
            const amountIn = decodeApproveAmount(pair.approve.data);
            // Every entry names its own leg (symbol + target token) so PlanScreen matches a
            // check to the right stock, never by position (design critique P0 #1).
            const leg = { symbol: built.symbol, token: built.tokenOut };
            if (amountIn === undefined) {
              return { status: "skipped", reason: "Couldn't check this trade with Binance just now.", checkedAt: Date.now(), ...leg } satisfies DryRun;
            }
            const dr = await dryRunBscSwap({
              chain,
              taker,
              router: pair.swap.to,
              tokenIn: pair.approve.to,
              tokenOut: built.tokenOut,
              amountIn,
              swapData: pair.swap.data,
            });
            return { ...dr, ...leg };
          }),
        );
      } catch (err) {
        // Any leg failing fails the whole plan, naming that leg — never a partial batch.
        const refusal = legRefusalResponse(err);
        if (refusal) return refusal;
        throw err;
      }

      const result: InvestPlanResult = {
        plan: {
          planId: buildPlanId(allocation, nowSeconds),
          recHash: recHash(allocation),
          // Never below what the weights imply by tier, same floor the executor path applies.
          riskScore: Math.min(RISK_CEILING_BPS, Math.max(Math.round(allocation.riskScore), riskScoreFor(chain, allocation.allocations))),
          agentId: chain.contracts.agentId.toString() },
        inference: { assessedRisk: 0, maxRisk: 0, expiry: "0", signature: "0x" },
        legs: [],
        usdcTotal: usdcTotal.toString(),
        chain: chain.key,
        executor: chain.contracts.executor,
        explorer: chain.explorer.url,
        notes: [],
        calls,
        dryRuns,
      };
      return Response.json(result);
    }

    // BNB Chain's executor path (a Binance router behind a live executor, ADR-0005): the same
    // account and cash gate as the direct path, and the catalog + token list read once so every
    // stock leg buys the issuer the plan showed, re-checked buyable (lib/legBuilder.ts). Base and
    // Mantle have no Binance router and skip all of this, exactly as before.
    const bscExecutor = Boolean(chain.routers.binance);
    let taker: `0x${string}` | undefined;
    if (bscExecutor) {
      const gate = await bscAccountGate(user.userId, chain, address, grossTotal);
      if ("refusal" in gate) return gate.refusal;
      taker = gate.taker;
    }

    // serverClient batches the per-leg pool reads into one multicall eth_call.
    let legs: Awaited<ReturnType<typeof buildLegs>>["legs"];
    let notes: string[];
    try {
      ({ legs, notes } = await buildLegs({
        chain,
        allocation,
        usdcTotal,
        client: serverClient(chain),
        nowSeconds,
        ...(bscExecutor ? { bscMarket: await loadBscMarket(nowMs) } : {}),
      }));
    } catch (err) {
      // BNB Chain: a closed, paused, under-$6 or unpriceable leg stops the whole plan before
      // anything is signed, in the direct path's own words.
      const refusal = legRefusalResponse(err);
      if (refusal) return refusal;
      throw err;
    }

    if (legs.length === 0) {
      return badRequest("Could not build any swap legs for this allocation.");
    }

    const planId = buildPlanId(allocation, nowSeconds);
    // The signed risk is never lower than what the weights imply by tier, so a
    // hand-edited link (or a generous model) can't understate it.
    const assessedRisk = Math.max(
      0,
      Math.min(
        RISK_CEILING_BPS,
        Math.max(Math.round(allocation.riskScore), riskScoreFor(chain, allocation.allocations)),
      ),
    );
    const maxRisk = Math.min(RISK_CEILING_BPS, assessedRisk + RISK_HEADROOM_BPS);
    const expiry = BigInt(nowSeconds + EXPIRY_SECONDS);

    const signature = await signRiskInference(chain, { planId, assessedRisk, maxRisk, expiry });

    // BNB Chain: one Binance dry run of exactly what the client will send, the account's
    // executeBatch([approve(USDT, executor, usdcTotal), investWithAI(...)]) built by the same
    // encoder useInvest uses, reported per leg so useInvest refuses to send a "failed" plan and
    // PlanScreen shows each stock's check. Never claims a check that didn't run (lib/server/dryRun.ts).
    let dryRuns: DryRun[] | undefined;
    if (bscExecutor && taker) {
      const batch = executorInvestCalls({
        chain,
        plan: { planId, recHash: recHash(allocation), riskScore: assessedRisk, agentId: chain.contracts.agentId },
        inference: { assessedRisk, maxRisk, expiry, signature },
        legs,
        usdcTotal,
        feeRaw: grossTotal - usdcTotal,
      });
      dryRuns = await dryRunBscExecutorBatch({
        chain,
        taker,
        calls: batch,
        legs: legs.map((l) => ({ symbol: assetSymbolForToken(chain, l.tokenOut) ?? "", token: l.tokenOut })),
      });
    }

    const result: InvestPlanResult = {
      plan: {
        planId,
        recHash: recHash(allocation),
        riskScore: assessedRisk,
        agentId: chain.contracts.agentId.toString(),
      },
      inference: {
        assessedRisk,
        maxRisk,
        expiry: expiry.toString(),
        signature,
      },
      legs: legs.map((l) => ({
        router: l.router,
        tokenOut: l.tokenOut,
        usdcIn: l.usdcIn.toString(),
        minOut: l.minOut.toString(),
        swapData: l.swapData,
      })),
      usdcTotal: usdcTotal.toString(),
      chain: chain.key,
      executor: chain.contracts.executor,
      explorer: chain.explorer.url,
      notes,
      ...(dryRuns ? { dryRuns } : {}),
    };
    return Response.json(result);
  } catch (err) {
    return serverError("invest-plan", err);
  }
}
