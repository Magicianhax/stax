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
import { balancesBatched, rawBalanceMap } from "@/lib/server/binance/wallet";
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

/**
 * BSC's raw token balances via the Binance Wallet API (one batched read across every candidate
 * address — cash, every stock's default mint, every twin mint, crypto) instead of a per-token RPC
 * `balanceOf`. Cached per address for the same window as the route's own `Cache-Control`, so a
 * user re-polling the page doesn't redraw the shared 5-per-window Binance budget every few
 * seconds. Returns `null` on ANY failure (bad shape, timeout, rate limit) so the caller falls
 * back to the RPC multicall below and the portfolio never goes blank for a Binance hiccup.
 */
const BSC_BALANCE_CACHE_TTL_MS = 10_000;
const bscBalanceCache = new Map<string, { at: number; value: Promise<Map<string, bigint>> }>();

function cachedBscBalances(address: `0x${string}`, tokenAddresses: `0x${string}`[]): Promise<Map<string, bigint>> {
  const key = address.toLowerCase();
  const hit = bscBalanceCache.get(key);
  if (hit && Date.now() - hit.at < BSC_BALANCE_CACHE_TTL_MS) return hit.value;
  const value = balancesBatched(address, tokenAddresses).then(rawBalanceMap);
  bscBalanceCache.set(key, { at: Date.now(), value });
  value.catch(() => bscBalanceCache.delete(key)); // don't let a failure poison later polls
  return value;
}

async function bscRawBalances(chain: StaxChain, address: `0x${string}`, tokenAddresses: `0x${string}`[]): Promise<Map<string, bigint> | null> {
  if (chain.key !== "bsc") return null;
  try {
    return await cachedBscBalances(address, tokenAddresses);
  } catch (err) {
    console.warn("[portfolio] Binance Wallet API balances unavailable, falling back to RPC:", err instanceof Error ? err.message : err);
    return null;
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

    const [binanceMap, prices, day, twinPrices] = await Promise.all([
      bscRawBalances(chain, address as `0x${string}`, readAddresses),
      cachedPrices(chain),
      getDaySummary(chain).catch(() => ({}) as Awaited<ReturnType<typeof getDaySummary>>),
      twinPricesByAddress(chain),
    ]);

    // BSC's own balances came back above — no RPC multicall needed at all. Off BSC, or when
    // Binance errored (bscRawBalances already logged why), the ORIGINAL per-token RPC multicall
    // runs exactly as it always did, so a Binance outage never blanks the portfolio.
    const results = binanceMap
      ? null
      : await client.multicall({
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
        });

    // One accessor per source: a failed/absent RPC read and an address Binance's response never
    // mentioned both mean the same thing here — "not held" (0n) — so every downstream line reads
    // identically whichever source answered.
    const cashRaw = binanceMap
      ? (binanceMap.get(chain.usdc.address.toLowerCase()) ?? BigInt(0))
      : results![0].status === "success"
        ? (results![0].result as bigint)
        : BigInt(0);
    const cashUsd = fromUnits(cashRaw, chain.usdc.decimals);

    const defaultRawFor = (i: number, asset: (typeof assets)[number]): bigint => {
      if (binanceMap) return binanceMap.get(asset.address!.toLowerCase()) ?? BigInt(0);
      const r = results![i + 1];
      return r.status === "success" ? (r.result as bigint) : BigInt(0);
    };
    const twinRawFor = (asset: (typeof assets)[number], twinIndex: number): bigint | undefined => {
      if (!asset.twin) return undefined;
      if (binanceMap) return binanceMap.get(asset.twin.address.toLowerCase());
      const r = results![1 + assets.length + twinIndex];
      return r.status === "success" ? (r.result as bigint) : undefined;
    };

    const holdings: PortfolioHoldingRow[] = [];
    let twinIndex = 0;
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const twinRaw = asset.twin ? twinRawFor(asset, twinIndex++) : undefined;
      const p = prices[asset.symbol];
      holdings.push(
        ...buildAssetRows({
          asset,
          defaultRaw: defaultRawFor(i, asset),
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
