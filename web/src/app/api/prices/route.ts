// GET /api/prices — live USD spot for every Stax asset, read from DEX pools.
// Cached briefly (the underlying pools move slowly relative to a page view) so a
// burst of clients doesn't hammer the RPC. Stocks price off Fluxion, sUSDe/mETH
// off their Agni route; assets with no live source report priceUsd: null.
import type { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { MANTLE_CHAIN, MULTICALL3 } from "@/lib/mantle";
import { priceAll } from "@/lib/prices";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

export const revalidate = 0; // we manage caching via Cache-Control below

const RPC_URL = process.env.NEXT_PUBLIC_MANTLE_RPC_URL || "https://rpc.mantle.xyz";

// batch.multicall folds the ~30 parallel pool reads (15 assets × slot0/token0)
// into one eth_call. Without it the public RPC rate-limits the tail of the burst
// and the late assets (SPY, QQQ, sUSDe, mETH) silently price as "none".
const publicClient = createPublicClient({
  chain: {
    id: MANTLE_CHAIN.id,
    name: MANTLE_CHAIN.name,
    nativeCurrency: MANTLE_CHAIN.nativeCurrency,
    rpcUrls: MANTLE_CHAIN.rpcUrls,
    contracts: { multicall3: { address: MULTICALL3 } },
  },
  batch: { multicall: { wait: 16 } },
  transport: http(RPC_URL),
});

export async function GET(req: NextRequest) {
  // Public market data (used pre-login on the landing), so no auth — but rate
  // limit per IP so it can't be hammered to drive RPC cost.
  const limit = rateLimit(`prices:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  try {
    const prices = await priceAll(publicClient);
    // Serialize to JSON-safe (numbers/null already are).
    const body = {
      prices,
      asOf: new Date().toISOString(),
    };
    return Response.json(body, {
      headers: {
        // Edge/browser cache 15s, allow 45s stale-while-revalidate.
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
      },
    });
  } catch (err) {
    return serverError("prices", err);
  }
}
