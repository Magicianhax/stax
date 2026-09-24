// GET /api/earnings?chain=bsc — next earnings date for each of the curated BSC tokenized
// stocks (brief idea 6). Public market data, same shape of route as /api/rwa: no auth,
// rate-limited per IP, and BSC is the only chain this exists for.
//
// BSC only. Every other `chain` value (including the default "base" a bare /api/earnings would
// otherwise resolve to) is a 400 — Base and Mantle have no earnings calendar, and answering with
// an empty one would read as "nothing reports soon" instead of "wrong chain".
import type { NextRequest } from "next/server";
import { getChain } from "@/lib/chains";
import { getNextEarnings } from "@/lib/server/earnings";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests } from "@/lib/server/respond";

export const revalidate = 0; // caching is managed via Cache-Control below

// A cold cache (lib/server/earnings.ts's per-ticker 12h entries all missed at once) fetches
// ~36 Yahoo quote pages at a concurrency of 6 — comfortably past Vercel's 10s default, so this
// mirrors app/api/cron/spread/route.ts's own 60s allowance rather than risking a mid-refresh 504.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`earnings:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chainParam = new URL(req.url).searchParams.get("chain");
  if (chainParam !== "bsc") return badRequest("The earnings calendar only exists on BSC. Pass ?chain=bsc.");

  try {
    const symbols = getChain("bsc").assets.stocks.map((asset) => asset.symbol);
    const earnings = await getNextEarnings(symbols);
    return Response.json(
      { earnings, asOf: Date.now() },
      {
        // Edge/browser cache 1h, stale-while-revalidate up to 12h — matched to the underlying
        // per-ticker cache TTL so a client is never told to refetch sooner than a fresher answer
        // could actually exist.
        headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=43200" },
      },
    );
  } catch (err) {
    // getNextEarnings is already best-effort per ticker and shouldn't throw; an honest 503 beats
    // silently returning an "all unavailable" map that looks like real, checked data.
    return serverError("earnings", err, 503);
  }
}
