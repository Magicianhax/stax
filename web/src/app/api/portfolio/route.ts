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
import { ERC20_ABI } from "@/lib/abis";
import type { ChainKey, StaxChain } from "@/lib/chains/types";
import { priceAll } from "@/lib/prices";
import { fromUnits } from "@/lib/format";
import { buildAssetRows, type PortfolioHoldingRow } from "@/lib/portfolioRows";
import { chainFromRequest, serverClient } from "@/lib/server/chain";
import { getBinanceWeb3 } from "@/lib/server/binance";
import { getDaySummary } from "@/lib/server/marketData";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

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
    // twin's own address, appended after the main asset list so both live in the one multicall.
    const twinned = assets.filter((a) => a.twin);
    const [results, prices, day, twinPrices] = await Promise.all([
      // USDC first, then the asset universe, then twin addresses — one multicall, one RPC request.
      client.multicall({
        contracts: [
          { address: chain.usdc.address, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [address as `0x${string}`] },
          ...assets.map((asset) => ({
            address: asset.address!,
            abi: ERC20_ABI,
            functionName: "balanceOf" as const,
            args: [address as `0x${string}`] as const,
          })),
          ...twinned.map((asset) => ({
            address: asset.twin!.address,
            abi: ERC20_ABI,
            functionName: "balanceOf" as const,
            args: [address as `0x${string}`] as const,
          })),
        ],
      }),
      cachedPrices(chain),
      getDaySummary(chain).catch(() => ({}) as Awaited<ReturnType<typeof getDaySummary>>),
      twinPricesByAddress(chain),
    ]);

    const usdcRead = results[0];
    const cashUsd =
      usdcRead.status === "success" ? fromUnits(usdcRead.result as bigint, chain.usdc.decimals) : 0;

    const twinOffset = 1 + assets.length;
    const twinRawBySymbol = new Map<string, bigint>();
    for (let j = 0; j < twinned.length; j++) {
      const r = results[twinOffset + j];
      if (r.status === "success") twinRawBySymbol.set(twinned[j].symbol, r.result as bigint);
    }

    const holdings: PortfolioHoldingRow[] = [];
    for (let i = 0; i < assets.length; i++) {
      const r = results[i + 1];
      const asset = assets[i];
      const twinRaw = asset.twin ? twinRawBySymbol.get(asset.symbol) : undefined;
      // A failed default-address read reads as "not held" (0n), same as before — but it must
      // not also hide a twin balance that DID read successfully, so this never `continue`s past
      // the twin row the way skipping the whole iteration would.
      if (r.status !== "success" && twinRaw === undefined) continue;
      const p = prices[asset.symbol];
      holdings.push(
        ...buildAssetRows({
          asset,
          defaultRaw: r.status === "success" ? (r.result as bigint) : BigInt(0),
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
    const investedUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);

    return Response.json(
      {
        chain: chain.key,
        cashUsd,
        investedUsd,
        totalUsd: cashUsd + investedUsd,
        holdings,
        asOf: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (err) {
    return serverError("portfolio", err);
  }
}
