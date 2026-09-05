// GET /api/prices — live USD spot for every asset on the request chain, read
// from DEX pools. Cached briefly (the underlying pools move slowly relative to a
// page view) so a burst of clients doesn't hammer the RPC. Stocks price off their
// USDC pool, routed assets off their route, aUSDC at $1 (+ Aave APY); assets with
// a Chainlink feed also carry `marketPrice` + `marketPriceAt` (feed updatedAt, unix
// s), and Coinbase B20 stocks carry `sharesPerToken` (multiplier / 1e18). All of
// it is one multicall per request burst. No live source → priceUsd: null.
import type { NextRequest } from "next/server";
import { priceAll } from "@/lib/prices";
import { chainFromRequest, serverClient } from "@/lib/server/chain";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

export const revalidate = 0; // we manage caching via Cache-Control below

export async function GET(req: NextRequest) {
  // Public market data (used pre-login on the landing), so no auth — but rate
  // limit per IP so it can't be hammered to drive RPC cost.
  const limit = rateLimit(`prices:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainFromRequest(req);

  try {
    // serverClient batches the parallel pool/feed reads into one multicall eth_call.
    const prices = await priceAll(chain, serverClient(chain));
    return Response.json(
      { chain: chain.key, prices, asOf: new Date().toISOString() },
      {
        headers: {
          // Edge/browser cache 15s, allow 45s stale-while-revalidate.
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
        },
      },
    );
  } catch (err) {
    return serverError("prices", err);
  }
}
