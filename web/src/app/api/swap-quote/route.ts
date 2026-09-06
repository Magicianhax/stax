// POST /api/swap-quote — KyberSwap aggregator quote (and optionally calldata) for the Pro
// manual buy/sell panel on aggregator chains (Base).
//
//   body     { symbol, side: "buy" | "sell", amountIn: string (raw units of tokenIn),
//              sender, recipient, slippageBps?: number (default 100), build?: boolean }
//   buy      USDC -> asset      sell  asset -> USDC
//   response { router, tokenIn, tokenOut, amountIn, amountOut, minOut, data?, expiresAt }
//            amounts are raw-unit decimal strings; `data` (router calldata) only when build=true;
//            `expiresAt` is unix ms — Kyber routes are good for ~10s, so the client fetches with
//            build=true immediately before sending the UserOp.
//   errors   400 unknown / coming / non-routable symbol or bad body · 404 no route · 502 Kyber down
//
// The client's sponsored UserOp is [ fee → treasury (buys), ERC20.approve(router, amountIn),
// { to: router, data } ]. `sender` = `recipient` = the user's smart account, so the router pulls
// tokenIn from the account and delivers tokenOut back to it. Stax's platform fee stays the
// existing treasury transfer — Kyber's extraFee is never used.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { assetBySymbol, isRoutable } from "@/lib/chains";
import { chainFromRequest } from "@/lib/server/chain";
import { KyberError, KyberNoRoute, kyberBuild, kyberRoute } from "@/lib/server/kyber";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError, jsonError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BPS = BigInt(10_000);
const DEFAULT_SLIPPAGE_BPS = 100;
const DEADLINE_SECONDS = 15 * 60;
/** How long a returned quote / calldata is considered fresh by the client. */
const QUOTE_TTL_MS = 10_000;

const SwapQuoteRequestSchema = z.object({
  symbol: z.string().min(1).max(16),
  side: z.enum(["buy", "sell"]),
  amountIn: z.string().regex(/^\d{1,40}$/, "amountIn must be a raw integer string."),
  sender: z.string().refine((a) => isAddress(a), "Invalid sender."),
  recipient: z.string().refine((a) => isAddress(a), "Invalid recipient."),
  slippageBps: z.number().int().min(0).max(2000).optional(),
  build: z.boolean().optional(),
});

export interface SwapQuoteResponse {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  amountOut: string;
  minOut: string;
  /** Router calldata — present only when the request had build=true. */
  data?: `0x${string}`;
  /** Unix ms after which the client should re-quote. */
  expiresAt: number;
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // Quotes refetch on every keystroke burst + a 15s interval; 120/min is ample.
  const limit = rateLimit(`swap-quote:${user.userId}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainFromRequest(req);
  if (!chain.routers.kyber) return badRequest(`Aggregator quotes are not available on ${chain.name}.`);

  let body: z.infer<typeof SwapQuoteRequestSchema>;
  try {
    body = SwapQuoteRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  const asset = assetBySymbol(chain, body.symbol);
  if (!asset || !asset.address || asset.via === "aave_v3" || !isRoutable(chain, body.symbol)) {
    return badRequest(`That asset isn't tradable on ${chain.name} yet.`);
  }
  const amountIn = BigInt(body.amountIn);
  if (amountIn <= BigInt(0)) return badRequest("Amount too small.");

  const usdc = chain.usdc.address;
  const tokenIn = body.side === "buy" ? usdc : asset.address;
  const tokenOut = body.side === "buy" ? asset.address : usdc;
  const slippageBps = body.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const sender = body.sender as `0x${string}`;
  const recipient = body.recipient as `0x${string}`;

  try {
    const route = await kyberRoute(chain, { tokenIn, tokenOut, amountIn });
    if (!route) return jsonError(404, `No swap route for ${asset.symbol} on ${chain.name} right now.`);

    let amountOut = route.amountOut;
    let data: `0x${string}` | undefined;
    if (body.build) {
      const built = await kyberBuild(chain, {
        routeSummary: route.routeSummary,
        sender,
        recipient,
        slippageBps,
        deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
      });
      if (built.amountIn !== amountIn) return jsonError(502, "The aggregator changed the swap amount. Please try again.");
      amountOut = built.amountOut;
      data = built.data;
    }
    const minOut = (amountOut * (BPS - BigInt(slippageBps))) / BPS;

    const result: SwapQuoteResponse = {
      router: route.routerAddress,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      minOut: minOut.toString(),
      ...(data ? { data } : {}),
      expiresAt: Date.now() + QUOTE_TTL_MS,
    };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof KyberNoRoute) return jsonError(404, `No swap route for ${asset.symbol} on ${chain.name} right now.`);
    if (err instanceof KyberError) {
      console.error("[swap-quote]", err.message);
      return jsonError(502, "The swap aggregator is unavailable right now. Please try again.");
    }
    return serverError("swap-quote", err);
  }
}
