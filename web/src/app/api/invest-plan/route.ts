import type { NextRequest } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { z } from "zod";
import { AllocationSchema } from "@/lib/allocation-schema";
import { MANTLE_CHAIN } from "@/lib/mantle";
import { buildLegs, STAX_EXECUTOR } from "@/lib/legBuilder";
import { buildPlanId, recHash, signRiskInference } from "@/lib/eip712";
import { netOf } from "@/lib/fees";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Signs with the agent key + reads chain state — never cache.
export const dynamic = "force-dynamic";

// M-1: hard upper bound on a single plan so a caller can't get the agent to sign
// an absurd approval. 6-figure cap is well above any realistic tap-to-invest.
const MAX_AMOUNT_USD = 1_000_000;

const AGENT_ID = BigInt(process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1");
const RPC_URL = process.env.NEXT_PUBLIC_MANTLE_RPC_URL || "https://rpc.mantle.xyz";

const RISK_HEADROOM_BPS = 1500; // how far above assessed risk we let maxRisk sit
const RISK_CEILING_BPS = 10000;
const EXPIRY_SECONDS = 15 * 60;

const InvestPlanRequestSchema = z.object({
  address: z.string().refine((a) => isAddress(a), "Invalid wallet address."),
  allocation: AllocationSchema,
  amountUsd: z.number().positive().max(MAX_AMOUNT_USD),
});

const publicClient = createPublicClient({
  chain: {
    id: MANTLE_CHAIN.id,
    name: MANTLE_CHAIN.name,
    nativeCurrency: MANTLE_CHAIN.nativeCurrency,
    rpcUrls: MANTLE_CHAIN.rpcUrls,
  },
  transport: http(RPC_URL),
});

export async function POST(req: NextRequest) {
  // C-2: only a signed-in user can have the agent sign a plan.
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // M-5: cap signing requests per user.
  const limit = rateLimit(`invest-plan:${user.userId}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

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
    const grossTotal = BigInt(Math.round(amountUsd * 1_000_000));
    if (grossTotal <= BigInt(0)) {
      return badRequest("Amount too small.");
    }
    const usdcTotal = netOf(grossTotal);

    // Clock read at request time (allowed here) — drives planId nonce + expiry.
    const nowSeconds = Math.floor(Date.now() / 1000);

    const { legs, notes } = await buildLegs({
      allocation,
      usdcTotal,
      client: publicClient,
      nowSeconds,
    });

    if (legs.length === 0) {
      return badRequest("Could not build any swap legs for this allocation.");
    }

    const planId = buildPlanId(allocation, nowSeconds);
    const assessedRisk = Math.max(0, Math.min(RISK_CEILING_BPS, Math.round(allocation.riskScore)));
    const maxRisk = Math.min(RISK_CEILING_BPS, assessedRisk + RISK_HEADROOM_BPS);
    const expiry = BigInt(nowSeconds + EXPIRY_SECONDS);

    const signature = await signRiskInference({ planId, assessedRisk, maxRisk, expiry });

    const plan = {
      planId,
      recHash: recHash(allocation),
      riskScore: assessedRisk,
      agentId: AGENT_ID.toString(),
    };

    const inference = {
      assessedRisk,
      maxRisk,
      expiry: expiry.toString(),
      signature,
    };

    const serializedLegs = legs.map((l) => ({
      router: l.router,
      tokenOut: l.tokenOut,
      usdcIn: l.usdcIn.toString(),
      minOut: l.minOut.toString(),
      swapData: l.swapData,
    }));

    return Response.json({
      plan,
      inference,
      legs: serializedLegs,
      usdcTotal: usdcTotal.toString(),
      executor: STAX_EXECUTOR,
      notes,
    });
  } catch (err) {
    return serverError("invest-plan", err);
  }
}
