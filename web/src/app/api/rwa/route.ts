// GET /api/rwa?chain=bsc — the curated BSC tokenized-stock catalog: each ticker's on-chain
// price next to its reference, whether each issuer is trading it right now, and the venue a
// buy should use (lib/rwa.ts has the shapes). Public market data, same as /api/prices: no auth,
// rate-limited per IP, short-lived shared cache so a burst of clients costs one Binance call.
//
// BSC only. Every other `chain` value (including the default "base" a bare /api/rwa would
// otherwise resolve to) is a 400 — there is no RWA catalog on Base or Mantle, and silently
// answering with an empty one would look like "nothing is listed" instead of "wrong chain".
import type { NextRequest } from "next/server";
import { bscCatalogSnapshot } from "@/lib/server/rwaCatalog";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests } from "@/lib/server/respond";

export const revalidate = 0; // we manage caching via Cache-Control below

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`rwa:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chainParam = new URL(req.url).searchParams.get("chain");
  if (chainParam !== "bsc") return badRequest("The RWA catalog only exists on BSC. Pass ?chain=bsc.");

  try {
    const { tickers, asOf } = await bscCatalogSnapshot(Date.now());
    return Response.json(
      { tickers, asOf },
      {
        headers: {
          // Edge/browser cache 15s, allow 15s stale-while-revalidate. The catalog's open/closed state
          // follows the clock (rebuilt on every read, lib/server/rwaCatalog.ts), so this is also how
          // long a row can keep saying "Open now" past the 16:00 close. The Binance-facing 45s cache
          // sits below, so a shorter edge window costs function calls, not Binance calls.
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15",
        },
      },
    );
  } catch (err) {
    // No fresh data and no fallback snapshot either (bscCatalogSnapshot already tried both) —
    // an honest 503 beats making up a "closed" catalog nobody asked for.
    return serverError("rwa", err, 503);
  }
}
