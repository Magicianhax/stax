// GET /api/rwa/[ticker]?chain=bsc — one ticker's catalog row plus the underlying company
// profile and recent candles, for the asset detail screen. Same public, rate-limited, cached
// shape as /api/rwa and /api/prices. The catalog row is read from the one shared, cached
// `rwaTokens()` snapshot (Task 7 / lib/server/rwaCatalog.ts); the profile and candles are their
// own Binance calls, so each is cached (and given the same stale-on-outage fallback) on its own.
import type { NextRequest } from "next/server";
import { BSC } from "@/lib/chains/bsc";
import { assetBySymbol } from "@/lib/chains";
import { bscCatalogSnapshot, cachedCandles, cachedRwaProfile } from "@/lib/server/rwaCatalog";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, jsonError, serverError, tooManyRequests } from "@/lib/server/respond";

// Binance's Web3 API refuses US traffic ("40304: Service not available due to compliance
// restriction"), and Vercel runs functions in Washington DC by default, so every route that
// reaches Binance runs in Frankfurt. The database is in us-east-1: one extra ocean crossing.
export const preferredRegion = "fra1";

export const dynamic = "force-dynamic";

const CANDLE_BAR = "1h" as const;
const CANDLE_LIMIT = 100;

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const limit = await rateLimit(`rwa-ticker:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chainParam = new URL(req.url).searchParams.get("chain");
  if (chainParam !== "bsc") return badRequest("The RWA catalog only exists on BSC. Pass ?chain=bsc.");

  const { ticker: symbol } = await params;
  const asset = assetBySymbol(BSC, symbol.toUpperCase());
  if (!asset || !asset.address) return jsonError(404, "That ticker isn't in the BSC catalog.");

  try {
    const { tickers } = await bscCatalogSnapshot(Date.now());
    const ticker = tickers.find((t) => t.ticker === asset.symbol);
    if (!ticker) return jsonError(404, "That ticker isn't in the BSC catalog.");

    const [profile, candles] = await Promise.all([
      cachedRwaProfile(asset.address),
      cachedCandles(asset.address, CANDLE_BAR, CANDLE_LIMIT),
    ]);

    return Response.json(
      { ticker, profile, candles },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=90" } },
    );
  } catch (err) {
    return serverError("rwa-ticker", err, 503);
  }
}
