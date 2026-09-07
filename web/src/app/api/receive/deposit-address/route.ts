// POST /api/receive/deposit-address — one open Relay deposit address for a (network, token) pair.
//   body { originChainId, originCurrency, refundTo? }
//   → { address, originChainId, originCurrency, symbol, vm, minUsd, feeUsd, reusable: true, ownAddress }
// The recipient is the caller's smart account (never the body); Base + USDC returns that account
// directly. `refundTo` is only read for Solana/Tron/Bitcoin origins. See docs/RECEIVE.md.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { chainKeyFromRequest } from "@/lib/server/chain";
import { getOrCreateDepositAddress, ReceiveInputError } from "@/lib/server/depositAddresses";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { RelayUnavailable } from "@/lib/server/relay";
import { badRequest, serverError, tooManyRequests, unauthorized } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  originChainId: z.number().int().positive(),
  originCurrency: z.string().trim().min(1).max(128),
  refundTo: z.string().trim().min(1).max(128).optional(),
});

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = await rateLimit(`receive-address:${user.userId}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Pick a network and a token first.");
  }

  try {
    const result = await getOrCreateDepositAddress({
      userId: user.userId,
      chain: chainKeyFromRequest(req),
      originChainId: body.originChainId,
      originCurrency: body.originCurrency,
      refundTo: body.refundTo,
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ReceiveInputError) return badRequest(err.message);
    if (err instanceof RelayUnavailable) return serverError("receive-address", err, 502);
    return serverError("receive-address", err);
  }
}
