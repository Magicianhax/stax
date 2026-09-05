// GET /api/activity?address=0x… — a user's Stax on-chain activity (AI invests
// via the executor) on the request chain, newest first. Public chain data, no
// auth — rate limited per IP, scan cached server-side. Same reason as
// /api/vera-record: the full deploy→latest eth_getLogs range exceeds the public
// RPC's 10k-block cap. Returns an empty list on a chain Stax isn't deployed on yet.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { explorerTx } from "@/lib/chains";
import { chainFromRequest } from "@/lib/server/chain";
import { getUserActivityServer } from "@/lib/server/executorLogs";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`activity:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return badRequest("A valid wallet address is required.");

  const chain = chainFromRequest(req);

  try {
    const activity = await getUserActivityServer(chain, address as `0x${string}`);
    return Response.json(
      {
        chain: chain.key,
        explorer: chain.explorer.url,
        activity: activity.map((a) => ({
          ...a,
          blockNumber: Number(a.blockNumber),
          explorerUrl: explorerTx(chain, a.txHash),
        })),
      },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch (err) {
    return serverError("activity", err);
  }
}
