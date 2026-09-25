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
import { buildSavingsDeposit, buildSavingsRedeem, getSavingsBalanceUsd, getSavingsRate, SavingsRefusal } from "@/lib/server/savings";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { getSmartAccount } from "@/lib/server/users";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Binance's Web3 API refuses US traffic ("40304: Service not available due to compliance
// restriction"), and Vercel runs functions in Washington DC by default, so every route that
// reaches Binance runs in Frankfurt. The database is in us-east-1: one extra ocean crossing.
export const preferredRegion = "fra1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface SavingsRateResponse {
  chain: string;
  available: boolean;
  apyBps?: number;
  apyDisplay?: string;
  /** The caller's current Savings balance in dollars, only when `?address=` was a valid address on
   *  BSC — `null` for "no savings yet" or a read failure, `undefined` when no address was given at
   *  all (so the shared, cacheable rate response for every OTHER viewer never carries a stale
   *  per-address number by accident). */
  balanceUsd?: number | null;
}

export async function GET(req: NextRequest) {
  const chain = chainFromRequest(req);
  const address = req.nextUrl.searchParams.get("address");
  const validAddress = address && isAddress(address) ? (address as `0x${string}`) : null;

  if (chain.key !== "bsc") {
    return Response.json({ chain: chain.key, available: false } satisfies SavingsRateResponse, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  }
  const [rate, balanceUsd] = await Promise.all([getSavingsRate(), validAddress ? getSavingsBalanceUsd(chain, validAddress) : Promise.resolve(undefined)]);
  const result: SavingsRateResponse = {
    chain: chain.key,
    ...(rate ? { available: true, apyBps: rate.apyBps, apyDisplay: rate.apyDisplay } : { available: false }),
    ...(validAddress ? { balanceUsd } : {}),
  };
  // A per-address balance is never shared across viewers — no-store whenever one was requested;
  // the address-less rate-only response stays cacheable exactly as it was before.
  const headers = validAddress
    ? { "Cache-Control": "no-store" }
    : { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };
  return Response.json(result, { headers });
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
