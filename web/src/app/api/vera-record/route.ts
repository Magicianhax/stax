// GET /api/vera-record[?user=0x…] — Vera's on-chain track record on the request
// chain (global, or scoped to one user) + her IdentityRegistry reputation there.
// Public chain data, no auth — rate limited per IP. Served from the indexer's copy
// in Postgres (browsers can't eth_getLogs the full deploy→latest range against the
// public RPC); the indexer is nudged first, bounded so a backfill never stalls the
// response. A chain Stax isn't deployed on yet yields a clean 0-state.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { explorerTx } from "@/lib/chains";
import { chainFromRequest } from "@/lib/server/chain";
import { getVeraRecordServer, getReputationServer } from "@/lib/server/executorLogs";
import { syncExecutorEvents } from "@/lib/server/indexer";

/** Longest a request waits on the indexer before serving what Postgres already has. */
const SYNC_WAIT_MS = 8_000;
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`vera-record:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const user = req.nextUrl.searchParams.get("user");
  if (user && !isAddress(user)) return badRequest("user must be a valid address.");

  const chain = chainFromRequest(req);

  try {
    await syncExecutorEvents(chain, { maxWaitMs: SYNC_WAIT_MS }); // never throws
    const [record, reputation] = await Promise.all([
      getVeraRecordServer(chain, (user as `0x${string}`) ?? undefined),
      getReputationServer(chain),
    ]);
    return Response.json(
      {
        chain: chain.key,
        explorer: chain.explorer.url,
        deployed: chain.contracts.deployed,
        record: {
          ...record,
          recentRecommendations: record.recentRecommendations.map((r) => ({
            ...r,
            blockNumber: Number(r.blockNumber), // bigint -> JSON-safe
            explorerUrl: explorerTx(chain, r.txHash),
          })),
        },
        reputation: reputation === null ? null : reputation.toString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    return serverError("vera-record", err);
  }
}
