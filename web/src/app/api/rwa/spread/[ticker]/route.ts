// GET /api/rwa/spread/[ticker]?chain=bsc — one ticker's price-vs-real-share history, per issuer,
// for the small line chart on the asset detail screen. Reads Redis via lib/server/spreadStore.ts
// (populated by app/api/cron/spread); a ticker that exists but has no recorded snapshots yet
// returns an honest empty list rather than a fake series. Same public, rate-limited, cached
// shape as /api/rwa/[ticker].
import type { NextRequest } from "next/server";
import { BSC } from "@/lib/chains/bsc";
import { assetBySymbol } from "@/lib/chains";
import type { RwaPlatform } from "@/lib/chains";
import { getSpreadHistory } from "@/lib/server/spreadStore";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests } from "@/lib/server/respond";
import type { SpreadTickerHistoryResponse } from "@/lib/spread";

// Binance's Web3 API refuses US traffic ("40304: Service not available due to compliance
// restriction"), and Vercel runs functions in Washington DC by default, so every route that
// reaches Binance runs in Frankfurt. The database is in us-east-1: one extra ocean crossing.
export const preferredRegion = "fra1";

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const limit = await rateLimit(`rwa-spread-ticker:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chainParam = new URL(req.url).searchParams.get("chain");
  if (chainParam !== "bsc") return badRequest("The price history only exists on BSC. Pass ?chain=bsc.");

  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  const asset = assetBySymbol(BSC, ticker);
  if (!asset || !asset.address) return jsonError(404, "That ticker isn't in the BSC catalog.");

  // Every platform this ticker could have a history under, in the order the board shows them:
  // its own default issuer, then the twin's, when it has one.
  const platforms: RwaPlatform[] = [asset.platform, asset.twin?.platform].filter((p): p is RwaPlatform => Boolean(p));

  try {
    const venues = await getSpreadHistory("bsc", ticker, platforms);
    const body: SpreadTickerHistoryResponse = { ticker, venues };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    return serverError("rwa-spread-ticker", err, 503);
  }
}
