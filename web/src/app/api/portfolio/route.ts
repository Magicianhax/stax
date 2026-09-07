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
import { chainFromRequest, serverClient } from "@/lib/server/chain";
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

interface PortfolioHolding {
  symbol: string;
  /** Raw balance as a decimal string (bigint-safe for JSON). */
  raw: string;
  qty: number;
  priceUsd: number | null;
  valueUsd: number | null;
  dayChangePct: number | null;
  spark: number[] | null;
  /** Supply APY (percent) for yield assets like aUSDC, when known. */
  apy: number | null;
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
    const [results, prices, day] = await Promise.all([
      // USDC first, then the asset universe — one multicall, one RPC request.
      client.multicall({
        contracts: [
          { address: chain.usdc.address, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [address as `0x${string}`] },
          ...assets.map((asset) => ({
            address: asset.address!,
            abi: ERC20_ABI,
            functionName: "balanceOf" as const,
            args: [address as `0x${string}`] as const,
          })),
        ],
      }),
      cachedPrices(chain),
      getDaySummary(chain).catch(() => ({}) as Awaited<ReturnType<typeof getDaySummary>>),
    ]);

    const usdcRead = results[0];
    const cashUsd =
      usdcRead.status === "success" ? fromUnits(usdcRead.result as bigint, chain.usdc.decimals) : 0;

    const holdings: PortfolioHolding[] = [];
    for (let i = 0; i < assets.length; i++) {
      const r = results[i + 1];
      if (r.status !== "success") continue; // one bad token never hides the rest
      const raw = r.result as bigint;
      if (raw === BigInt(0)) continue;
      const asset = assets[i];
      const qty = fromUnits(raw, asset.decimals!); // registry decimals (8 for B20 stocks)
      const p = prices[asset.symbol];
      const priceUsd = p?.priceUsd ?? null;
      holdings.push({
        symbol: asset.symbol,
        raw: raw.toString(),
        qty,
        priceUsd,
        valueUsd: priceUsd !== null ? qty * priceUsd : null,
        dayChangePct: day[asset.symbol]?.dayChangePct ?? null,
        spark: day[asset.symbol]?.spark ?? null,
        apy: p?.apy ?? null,
      });
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
