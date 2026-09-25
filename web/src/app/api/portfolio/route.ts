// GET /api/portfolio?address=0x… — the user's holdings on the request chain,
// fully valued on the server. ONE multicall reads USDC + every asset balance,
// prices come from the same DEX-pool spot source as /api/prices (cached 15s per
// chain across all users), and each holding is decorated with its real 1D
// market move for the row UI.
//
// The client renders this verbatim — no balance fan-out, no qty×price math, no
// price stitching on the frontend. Token decimals come from the registry (B20
// stocks are 8 dec, aUSDC 6, WETH 18) — never assumed.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import type { ChainKey, StaxChain } from "@/lib/chains/types";
import { priceAll } from "@/lib/prices";
import { fromUnits } from "@/lib/format";
import { buildAssetRows, type PortfolioHoldingRow } from "@/lib/portfolioRows";
import { chainFromRequest, serverClient } from "@/lib/server/chain";
import { getBinanceWeb3 } from "@/lib/server/binance";
import { bscBalanceMap } from "@/lib/server/bscBalances";
import { getSavingsBalanceUsd } from "@/lib/server/savings";
import { getDaySummary } from "@/lib/server/marketData";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Binance's Web3 API refuses US traffic ("40304: Service not available due to compliance
// restriction"), and Vercel runs functions in Washington DC by default, so every route that
// reaches Binance runs in Frankfurt. The database is in us-east-1: one extra ocean crossing.
export const preferredRegion = "fra1";

export const dynamic = "force-dynamic";

// Prices move slowly relative to page views — share one read per chain across all users.
const pricesCache = new Map<ChainKey, { at: number; value: ReturnType<typeof priceAll> }>();
function cachedPrices(chain: StaxChain) {
  const hit = pricesCache.get(chain.key);
  if (hit && Date.now() - hit.at < 15_000) return hit.value;
  const value = priceAll(chain, serverClient(chain)).catch((err) => {
    pricesCache.delete(chain.key);
    throw err;
  });
  pricesCache.set(chain.key, { at: Date.now(), value });
  return value;
}

/**
 * `RwaToken.tokenPrice` for every address the Binance catalog lists, on BSC only — the same
 * per-venue price the RWA catalog (Task 9) shows, so a twin holding's value agrees with what the
 * Venues panel says that issuer's token is worth right now, not the default venue's price
 * borrowed for lack of anything better. `getBinanceWeb3().rwaTokens()` holds its own cache
 * (Task 7), so this is never a fresh Binance call on every page view. Off BSC, or on any error,
 * an empty map means every twin row prices as null rather than guessing.
 */
async function twinPricesByAddress(chain: StaxChain): Promise<Map<string, number>> {
  if (chain.key !== "bsc") return new Map();
  try {
    const tokens = await getBinanceWeb3().rwaTokens();
    return new Map(tokens.map((t) => [t.tokenContractAddress.toLowerCase(), t.tokenPrice]));
  } catch (err) {
    console.warn("[portfolio] twin prices unavailable:", err instanceof Error ? err.message : err);
    return new Map();
  }
}

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`portfolio:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) return badRequest("Valid ?address required.");

  const chain = chainFromRequest(req);
  const client = serverClient(chain);

  try {
    const assets = chain.assets.all.filter((a) => a.address && a.decimals);
    // Assets with a twin (BSC only — see chains/bsc.assets.ts) get a second balance read at the
    // twin's own address.
    const twinned = assets.filter((a) => a.twin);
    const readAddresses = [
      chain.usdc.address,
      ...assets.map((a) => a.address!),
      ...twinned.map((a) => a.twin!.address),
    ];

    const [balanceMap, prices, day, twinPrices, savingsUsd] = await Promise.all([
      bscBalanceMap(chain, client, address as `0x${string}`, readAddresses),
      cachedPrices(chain),
      getDaySummary(chain).catch(() => ({}) as Awaited<ReturnType<typeof getDaySummary>>),
      twinPricesByAddress(chain),
      // Review fix (wave 5b): a Savings deposit used to vanish from net worth entirely — nothing
      // read the vUSDT balance it left behind. `getSavingsBalanceUsd` is BSC-only and null-safe
      // (off BSC, no vUSDT held, or a failed read all return null) — see lib/server/savings.ts.
      getSavingsBalanceUsd(chain, address as `0x${string}`),
    ]);

    // bscBalanceMap (lib/server/bscBalances.ts) already did the merge: BSC's own Wallet API read,
    // backfilled by a targeted RPC read for whatever Binance's response left out, or a full RPC
    // read off BSC / when Binance errored entirely — same behaviour as before this was factored
    // out, just shared with lib/server/bscHoldings.ts now too.
    //
    // One accessor for whichever source(s) answered: an address absent from the merged map means
    // "not held" (0n for cash/default rows; `undefined`, not a row at all, for a twin).
    const cashRaw = balanceMap.get(chain.usdc.address.toLowerCase()) ?? BigInt(0);
    const cashUsd = fromUnits(cashRaw, chain.usdc.decimals);

    const defaultRawFor = (asset: (typeof assets)[number]): bigint => balanceMap.get(asset.address!.toLowerCase()) ?? BigInt(0);
    const twinRawFor = (asset: (typeof assets)[number]): bigint | undefined =>
      asset.twin ? balanceMap.get(asset.twin.address.toLowerCase()) : undefined;

    const holdings: PortfolioHoldingRow[] = [];
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const twinRaw = twinRawFor(asset);
      const p = prices[asset.symbol];
      holdings.push(
        ...buildAssetRows({
          asset,
          defaultRaw: defaultRawFor(asset),
          defaultPriceUsd: p?.priceUsd ?? null,
          twinRaw,
          twinPriceUsd: asset.twin ? (twinPrices.get(asset.twin.address.toLowerCase()) ?? null) : undefined,
          dayChangePct: day[asset.symbol]?.dayChangePct ?? null,
          spark: day[asset.symbol]?.spark ?? null,
          apy: p?.apy ?? null,
        }),
      );
    }

    // Largest value first, unpriced last.
    holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    // Savings isn't a holding row (it has no matching chain.assets entry — it's a vUSDT position,
    // not a stock or a twin), but it's still the user's money: folded straight into the total so
    // moving cash into Savings never makes net worth look like it dropped.
    const investedUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0) + (savingsUsd ?? 0);

    return Response.json(
      {
        chain: chain.key,
        cashUsd,
        investedUsd,
        totalUsd: cashUsd + investedUsd,
        savingsUsd: savingsUsd ?? 0,
        holdings,
        asOf: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (err) {
    return serverError("portfolio", err);
  }
}
