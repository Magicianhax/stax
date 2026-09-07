// GET /api/transactions?address=0x… — a wallet's incoming + outgoing transfers
// on the request chain, newest first. Zerion when ZERION_API_KEY is set (Base),
// then Etherscan V2 (Mantle), Blockscout and an on-chain log scan. The answer is
// cached for 60 s per wallet, so a provider blip or a burst of page views does
// not reach them. `source` names the provider that actually answered.
// Public chain data, so no auth — but rate limited per IP since it can drive cost.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { chainFromRequest } from "@/lib/server/chain";
import { getWalletHistory } from "@/lib/server/walletTransfers";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`transactions:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return badRequest("A valid wallet address is required.");

  const chain = chainFromRequest(req);

  try {
    const { transactions, source } = await getWalletHistory(chain, address);
    return Response.json(
      { chain: chain.key, explorer: chain.explorer.url, transactions, source },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (err) {
    return serverError("transactions", err);
  }
}
