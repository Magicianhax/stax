// GET /api/market — real market history for charts and row sparklines, per chain.
//
//   ?symbol=AAPL&range=1M  -> { series, changePct, asOf } for the detail chart
//   (no params)            -> { summary: { [symbol]: { dayChangePct, spark } }, asOf }
//
// Sources: Yahoo Finance for the equities our tokenized stocks track, CoinGecko
// for the token tier (see lib/server/marketData.ts). Cached server-side so a
// screenful of clients costs at most one upstream call per symbol per TTL window.
import type { NextRequest } from "next/server";
import { assetBySymbol } from "@/lib/chains";
import { chainFromRequest } from "@/lib/server/chain";
import {
  getHistory,
  getDaySummary,
  MARKET_RANGES,
  type MarketRange,
} from "@/lib/server/marketData";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Public market data (shown pre-login), so no auth — rate-limited per IP.
  const limit = await rateLimit(`market:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainFromRequest(req);
  const symbol = req.nextUrl.searchParams.get("symbol");
  const range = req.nextUrl.searchParams.get("range") ?? "1M";

  try {
    // Summary mode — 1D change + spark for every asset (portfolio + market rows).
    if (!symbol) {
      const summary = await getDaySummary(chain);
      return Response.json(
        { chain: chain.key, summary, asOf: new Date().toISOString() },
        { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } },
      );
    }

    if (!assetBySymbol(chain, symbol)) return badRequest("Unknown symbol.");
    if (!MARKET_RANGES.includes(range as MarketRange)) return badRequest("Unknown range.");

    const history = await getHistory(chain, symbol, range as MarketRange);
    return Response.json(
      {
        chain: chain.key,
        series: history?.series ?? null,
        changePct: history?.changePct ?? null,
        asOf: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    return serverError("market", err);
  }
}
