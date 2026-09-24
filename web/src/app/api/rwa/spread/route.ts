// GET /api/rwa/spread?chain=bsc — the bStock-vs-Ondo board: every currently dual-listed ticker,
// ranked by the dollar difference between the two issuers, with a plain sentence per row
// ("Ondo is $0.40 cheaper than bStock right now"), plus every catalog ticker's premium/discount
// call and its cheaper-issuer-right-now pick. Reads the same cached catalog snapshot /api/rwa
// already builds (Task 9), so this spends no extra Binance calls of its own. Public market data:
// no auth, rate-limited per IP, same short-lived shared cache as /api/rwa.
//
// Snapshot history (why there's no dedicated cron): this project is on Vercel Hobby, which only
// allows a daily cron (see app/api/cron/autopilot's own comment and README.md) — a 15-minute
// vercel.json entry for app/api/cron/spread would fail every deploy. So this route claims its own
// 15-minute tick with a Redis `SET NX EX` (spreadStore.claimSpreadTick) and, on the request that
// wins it, records the catalog snapshot it already has in hand (recordCatalogSnapshot) — no extra
// Binance call, since bscCatalogSnapshot is itself cached. app/api/cron/spread is kept as a second
// path: an external scheduler (e.g. a GitHub Actions `schedule: */15` job) can still call it with
// the bearer secret, which is a human-gated step (setting that secret), not something this stream
// wires up on its own.
import type { NextRequest } from "next/server";
import { bscCatalogSnapshot } from "@/lib/server/rwaCatalog";
import { claimSpreadTick, recordCatalogSnapshot } from "@/lib/server/spreadStore";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, serverError, tooManyRequests } from "@/lib/server/respond";
import {
  SPREAD_SNAPSHOT_SPACING_MINUTES,
  cheaperIssuerNow,
  classifySpread,
  issuerDiffSentence,
  rankIssuerBoard,
  type SpreadBoardResponse,
  type SpreadTickerCall,
} from "@/lib/spread";

export const revalidate = 0; // caching is managed via Cache-Control below

const TICK_WINDOW_MS = SPREAD_SNAPSHOT_SPACING_MINUTES * 60 * 1000;

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`rwa-spread:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chainParam = new URL(req.url).searchParams.get("chain");
  if (chainParam !== "bsc") return badRequest("The price-vs-real-share board only exists on BSC. Pass ?chain=bsc.");

  try {
    const { tickers: catalogTickers, asOf } = await bscCatalogSnapshot(Date.now());

    // Opportunistic snapshot recording — see the header comment. Never blocks or fails the
    // response: a claim/record error just means this tick's history point is missing, not a 503.
    try {
      if (await claimSpreadTick("bsc", asOf, TICK_WINDOW_MS)) {
        await recordCatalogSnapshot("bsc", catalogTickers, asOf);
      }
    } catch (err) {
      console.warn("[rwa-spread] snapshot recording failed:", err instanceof Error ? err.message : err);
    }

    const board = rankIssuerBoard(catalogTickers).map((row) => ({ ...row, sentence: issuerDiffSentence(row) }));
    const perTicker: SpreadTickerCall[] = catalogTickers.map((t) => ({
      ticker: t.ticker,
      venues: t.venues.map((v) => ({ platform: v.platform, call: classifySpread(v) })),
      cheaperIssuer: cheaperIssuerNow(t.venues),
    }));
    const body: SpreadBoardResponse = { asOf, board, tickers: perTicker };
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
