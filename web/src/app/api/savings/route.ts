// GET  /api/savings          — the current Venus USDT rate (BSC only). Public: this is a
//                               marketing-grade number ("earns about 4.2% a year"), not user data.
// POST /api/savings           body { action: "deposit", amountUsd } | { action: "redeem", ratio }
//                              -> { calls: ExecCall[] } — unsigned calls the client sends as one
//                              sponsored UserOp through the same direct smart-account path
//                              useInvest.ts uses (assertSavingsCallsAreSafe, not
//                              assertExecCallsAreSafe — see lib/execution.ts).
//   errors  400 not on BSC / bad amount / bad ratio / no position to redeem (SavingsRefusal) ·
//           502 Binance unavailable
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { chainFromRequest } from "@/lib/server/chain";
import { buildSavingsDeposit, buildSavingsRedeem, getSavingsRate, SavingsRefusal } from "@/lib/server/savings";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { getSmartAccount } from "@/lib/server/users";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface SavingsRateResponse {
  chain: string;
  available: boolean;
  apyBps?: number;
  apyDisplay?: string;
}

export async function GET(req: NextRequest) {
  const chain = chainFromRequest(req);
  if (chain.key !== "bsc") {
    return Response.json({ chain: chain.key, available: false } satisfies SavingsRateResponse, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  }
  const rate = await getSavingsRate();
  const result: SavingsRateResponse = rate
    ? { chain: chain.key, available: true, apyBps: rate.apyBps, apyDisplay: rate.apyDisplay }
    : { chain: chain.key, available: false };
  // Short cache: an APY, not a balance — fine to be a few seconds stale for every viewer.
  return Response.json(result, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
}

const SavingsRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deposit"), address: z.string().refine((a) => isAddress(a), "Invalid address."), amountUsd: z.number().positive() }),
  z.object({ action: z.literal("redeem"), address: z.string().refine((a) => isAddress(a), "Invalid address."), ratio: z.number().positive().max(1) }),
]);

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const gate = await requireApproved(user);
  if (gate) return gate;

  const limit = await rateLimit(`savings:${user.userId}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainFromRequest(req);

  let body: z.infer<typeof SavingsRequestSchema>;
  try {
    body = SavingsRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  // The address must be the caller's own smart account on this chain — same rule
  // /api/swap-quote applies to `sender`, so a savings call can't be built for someone else's
  // account. No row yet (brand-new wallet) is allowed through; there's nothing to protect yet.
  const account = await getSmartAccount(user.userId, chain.key);
  if (account && account.address.toLowerCase() !== body.address.toLowerCase()) {
    return badRequest("Savings must be for your own account.");
  }
  const address = body.address as `0x${string}`;

  try {
    const calls =
      body.action === "deposit"
        ? await buildSavingsDeposit(chain, address, body.amountUsd)
        : await buildSavingsRedeem(chain, address, body.ratio);
    return Response.json({ calls }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof SavingsRefusal) return badRequest(err.message);
    return serverError("savings", err, 502);
  }
}
