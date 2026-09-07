// GET /api/portfolio/history?address=0x…&range=1M — cost basis + gains per
// holding and the account's value over the range, on the request chain.
// Public chain data valued server-side (same stance as /api/portfolio: no auth,
// rate limited per IP). Demo mode never calls this — usePortfolioHistory seeds
// its own data.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import type { MarketRange } from "@/hooks/useMarket";
import { chainFromRequest } from "@/lib/server/chain";
import { getPositionHistory, getValueHistory } from "@/lib/server/positions";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

const RANGES: MarketRange[] = ["1D", "1W", "1M", "1Y", "5Y"];

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`portfolio-history:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) return badRequest("Valid ?address required.");
  const rangeParam = (req.nextUrl.searchParams.get("range") ?? "1M").toUpperCase() as MarketRange;
  if (!RANGES.includes(rangeParam)) return badRequest("?range must be one of 1D, 1W, 1M, 1Y, 5Y.");

  const chain = chainFromRequest(req);
  const account = address as `0x${string}`;

  try {
    const [pos, hist] = await Promise.all([getPositionHistory(chain, account), getValueHistory(chain, account, rangeParam)]);
    return Response.json(
      {
        chain: chain.key,
        range: rangeParam,
        positions: pos.positions,
        series: hist.series,
        coverageFrom: pos.coverageFrom,
        totals: pos.totals,
        cashUsd: pos.cashUsd,
        asOf: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (err) {
    return serverError("portfolio-history", err);
  }
}
