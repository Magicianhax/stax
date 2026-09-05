import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { AllocationSchema } from "@/lib/allocation-schema";
import { buildLegs } from "@/lib/legBuilder";
import { buildPlanId, recHash, signRiskInference } from "@/lib/eip712";
import { netOf } from "@/lib/fees";
import { chainFromRequest, serverClient } from "@/lib/server/chain";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError, jsonError } from "@/lib/server/respond";
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

export async function POST(req: NextRequest) {
  // C-2: only a signed-in user can have the agent sign a plan.
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // M-5: cap signing requests per user.
  const limit = rateLimit(`invest-plan:${user.userId}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  // Which chain the plan is for (x-stax-chain header / ?chain=; Base default).
  const chain = chainFromRequest(req);
  if (!chain.contracts.deployed) {
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
    const { allocation, amountUsd } = body;

    // USDC is 6dp. Round to whole micro-USDC. The platform fee is skimmed by the
    // client (a batched USDC transfer to the treasury), so we deploy the NET into
    // assets — build the legs against the net so they sum correctly.
    const grossTotal = BigInt(Math.round(amountUsd * 10 ** chain.usdc.decimals));
    if (grossTotal <= BigInt(0)) {
      return badRequest("Amount too small.");
    }
    const usdcTotal = netOf(grossTotal);

    // Clock read at request time (allowed here) — drives planId nonce + expiry.
    const nowSeconds = Math.floor(Date.now() / 1000);

    // serverClient batches the per-leg pool reads into one multicall eth_call.
    const { legs, notes } = await buildLegs({
      chain,
      allocation,
      usdcTotal,
      client: serverClient(chain),
      nowSeconds,
    });

    if (legs.length === 0) {
      return badRequest("Could not build any swap legs for this allocation.");
    }

    const planId = buildPlanId(allocation, nowSeconds);
    const assessedRisk = Math.max(0, Math.min(RISK_CEILING_BPS, Math.round(allocation.riskScore)));
    const maxRisk = Math.min(RISK_CEILING_BPS, assessedRisk + RISK_HEADROOM_BPS);
    const expiry = BigInt(nowSeconds + EXPIRY_SECONDS);

    const signature = await signRiskInference(chain, { planId, assessedRisk, maxRisk, expiry });

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
    };
    return Response.json(result);
  } catch (err) {
    return serverError("invest-plan", err);
  }
}
