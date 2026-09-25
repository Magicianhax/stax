// GET /api/prices — live USD spot for every asset on the request chain, read
// from DEX pools. Cached briefly (the underlying pools move slowly relative to a
// page view) so a burst of clients doesn't hammer the RPC. Stocks price off their
// USDC pool, routed assets off their route, aUSDC at $1 (+ Aave APY); assets with
// a Chainlink feed also carry `marketPrice` + `marketPriceAt` (feed updatedAt, unix
// s), and Coinbase B20 stocks carry `sharesPerToken` (multiplier / 1e18). All of
// it is one multicall per cache window. No live source → priceUsd: null.
import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { priceAll } from "@/lib/prices";
import { cached } from "@/lib/server/cache";
import { chainFromRequest, serverClient } from "@/lib/server/chain";
import { recordPriceSnapshots } from "@/lib/server/priceSnapshots";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

// Binance's Web3 API refuses US traffic ("40304: Service not available due to compliance
// restriction"), and Vercel runs functions in Washington DC by default, so every route that
// reaches Binance runs in Frankfurt. The database is in us-east-1: one extra ocean crossing.
export const preferredRegion = "fra1";

export const revalidate = 0; // we manage caching via Cache-Control below

export async function GET(req: NextRequest) {
  // Public market data (used pre-login on the landing), so no auth — but rate
  // limit per IP so it can't be hammered to drive RPC cost.
  const limit = await rateLimit(`prices:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainFromRequest(req);

  try {
    // 15 s shared cache (Upstash when configured, else per instance); `asOf` is
    // when the prices were actually read, so it is cached with them.
    const { prices, asOf } = await cached(`prices:${chain.key}`, 15, async () => {
      // serverClient batches the parallel pool/feed reads into one multicall eth_call.
      const prices = await priceAll(chain, serverClient(chain));
      // Write-through snapshot (≤ one per 15 min per chain), only on a cache miss.
      // Off the response path: never awaited, never throws; waitUntil keeps the
      // instance alive to finish it.
      waitUntil(recordPriceSnapshots(chain, prices));
      return { prices, asOf: new Date().toISOString() };
    });
    return Response.json(
      { chain: chain.key, prices, asOf },
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
