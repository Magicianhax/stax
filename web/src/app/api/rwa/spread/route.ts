// GET /api/rwa/spread?chain=bsc — the bStock-vs-Ondo board: every currently dual-listed ticker,
// ranked by the dollar difference between the two issuers, with a plain sentence per row
// ("Ondo is $0.40 cheaper than bStock right now"). Reads the same cached catalog snapshot
// /api/rwa already builds (Task 9), so this spends no extra Binance calls of its own. Public
// market data: no auth, rate-limited per IP, same short-lived shared cache as /api/rwa.
import type { NextRequest } from "next/server";
import { bscCatalogSnapshot } from "@/lib/server/rwaCatalog";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests } from "@/lib/server/respond";
import { issuerDiffSentence, rankIssuerBoard, type SpreadBoardResponse } from "@/lib/spread";

export const revalidate = 0; // caching is managed via Cache-Control below

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`rwa-spread:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chainParam = new URL(req.url).searchParams.get("chain");
  if (chainParam !== "bsc") return badRequest("The price-vs-real-share board only exists on BSC. Pass ?chain=bsc.");

  try {
    const { tickers, asOf } = await bscCatalogSnapshot(Date.now());
    const board = rankIssuerBoard(tickers).map((row) => ({ ...row, sentence: issuerDiffSentence(row) }));
    const body: SpreadBoardResponse = { asOf, board };
    return Response.json(body, {
      headers: {
        // Same window as /api/rwa: a bit shorter than the 45s Binance-facing cache so a
        // client refetches before the underlying catalog can turn over twice.
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    return serverError("rwa-spread", err, 503);
  }
}
