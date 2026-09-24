import "server-only";

// The RWA Data API, prefix /api/v1/dex/market/rwa (docs/BINANCE-WEB3.md §2). Every field here
// was checked against a live response; the wire sends numbers as strings, so they are parsed
// to `number` at this boundary and nothing downstream touches a string price again.
import { z } from "zod";
import { cached } from "@/lib/server/cache";
import type { RwaPlatform } from "@/lib/chains";
import { web3Request } from "./client";
import { BinanceWeb3Error } from "./types";
import type { RwaPrice, RwaSearchResult, RwaToken } from "./types";

const BINANCE_CHAIN_ID = "56";

const wireStatusInfo = z.object({
  openState: z.boolean(),
  marketStatus: z.string().nullable(),
  reasonCode: z.string(),
  reasonMsg: z.string().nullable(),
  nextOpenTime: z.number().nullable(),
  nextCloseTime: z.number().nullable(),
});

const wireRwaToken = z.object({
  binanceChainId: z.string(),
  tokenContractAddress: z.string(),
  platformId: z.enum(["ondo", "bstock"]),
  assetType: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  tokenName: z.string(),
  tokenSymbol: z.string(),
  tokenLogoUrl: z.string(),
  decimals: z.string(),
  underlyingTicker: z.string(),
  // Live catalog rows can carry either as null (seen on bstock rows like INTWB, KORUB, MVLLB,
  // MUUB, SNXXB for marketCap, and on Ondo rows like HYGWon, SECUon, SYSBon for underlyingName) —
  // rejecting the whole ~500-row array over a handful of incomplete display fields would leave
  // every BSC screen with no stocks at all, so these two are nullable at the wire and given a
  // fallback below rather than failing the batch.
  underlyingName: z.string().nullable(),
  tokenToShareRatio: z.string(),
  statusInfo: wireStatusInfo,
  tokenPrice: z.string(),
  referencePrice: z.string(),
  volume24H: z.string(),
  marketCap: z.string().nullable(),
});

function parseRwaToken(row: z.infer<typeof wireRwaToken>): RwaToken {
  return {
    binanceChainId: row.binanceChainId,
    tokenContractAddress: row.tokenContractAddress.toLowerCase() as `0x${string}`,
    platformId: row.platformId,
    assetType: row.assetType,
    tokenName: row.tokenName,
    tokenSymbol: row.tokenSymbol,
    tokenLogoUrl: row.tokenLogoUrl,
    decimals: Number(row.decimals),
    underlyingTicker: row.underlyingTicker,
    // Fall back to the ticker so RwaToken.underlyingName can stay a plain string; every caller
    // that displays a name still gets something legible instead of "null".
    underlyingName: row.underlyingName ?? row.underlyingTicker,
    tokenToShareRatio: Number(row.tokenToShareRatio),
    statusInfo: {
      openState: row.statusInfo.openState,
      // The union in ./types is a superset of every value seen live plus the docs-only ones;
      // an entirely new value from Binance still round-trips as a string, it just won't match
      // one of Stax's display states until the type is widened.
      marketStatus: row.statusInfo.marketStatus as RwaToken["statusInfo"]["marketStatus"],
      reasonCode: row.statusInfo.reasonCode as RwaToken["statusInfo"]["reasonCode"],
      reasonMsg: row.statusInfo.reasonMsg,
      nextOpenTime: row.statusInfo.nextOpenTime,
      nextCloseTime: row.statusInfo.nextCloseTime,
    },
    tokenPrice: Number(row.tokenPrice),
    referencePrice: Number(row.referencePrice),
    volume24H: Number(row.volume24H),
    // 0 rather than NaN: a missing market cap is display-only and must not poison a sort or a
    // sum anywhere downstream the way NaN would.
    marketCap: row.marketCap === null ? 0 : Number(row.marketCap),
  };
}

/** Cached 45s: this is a ~500-row catalog fetch and every screen that lists BSC stocks reads it. */
export async function rwaTokens(o?: { platformId?: RwaPlatform }): Promise<RwaToken[]> {
  const cacheKey = `binance:rwa:tokens:${o?.platformId ?? "all"}`;
  return cached(cacheKey, 45, async () => {
    const data = await web3Request<unknown>("GET", "/api/v1/dex/market/rwa/tokens", {
      binanceChainId: BINANCE_CHAIN_ID,
      platformId: o?.platformId,
    });
    const parsed = z.array(wireRwaToken).safeParse(data);
    if (!parsed.success) {
      throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/market/rwa/tokens", 200);
    }
    return parsed.data.map(parseRwaToken);
  });
}

const wireRwaPrice = z.object({
  tokenContractAddress: z.string(),
  platformId: z.enum(["ondo", "bstock"]),
  tokenPrice: z.string(),
  referencePrice: z.string(),
  tokenPriceUpdatedAt: z.number(),
});

/** At most 100 addresses per call (docs/BINANCE-WEB3.md §2); refused before Binance sees it. */
export async function rwaPrices(addrs: `0x${string}`[]): Promise<RwaPrice[]> {
  if (addrs.length > 100) throw new Error(`rwaPrices: at most 100 addresses per call, got ${addrs.length}`);
  const data = await web3Request<unknown>("GET", "/api/v1/dex/market/rwa/price", {
    binanceChainId: BINANCE_CHAIN_ID,
    tokenContractAddresses: addrs.join(","),
  });
  const parsed = z.array(wireRwaPrice).safeParse(data);
  if (!parsed.success) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/market/rwa/price", 200);
  }
  return parsed.data.map((p) => ({
    tokenContractAddress: p.tokenContractAddress.toLowerCase() as `0x${string}`,
    platformId: p.platformId,
    tokenPrice: Number(p.tokenPrice),
    referencePrice: Number(p.referencePrice),
    tokenPriceUpdatedAt: p.tokenPriceUpdatedAt,
  }));
}

const wireRwaSearchResult = z.object({
  ticker: z.string(),
  companyName: z.string(),
  assets: z.array(
    z.object({
      platformId: z.enum(["ondo", "bstock"]),
      binanceChainId: z.string(),
      tokenContractAddress: z.string(),
      tokenSymbol: z.string(),
      assetType: z.number().nullable(),
    }),
  ),
});

export async function rwaSearch(keyword: string): Promise<RwaSearchResult[]> {
  const data = await web3Request<unknown>("GET", "/api/v1/dex/market/rwa/search", { keyword });
  const parsed = z.array(wireRwaSearchResult).safeParse(data);
  if (!parsed.success) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/market/rwa/search", 200);
  }
  return parsed.data.map((r) => ({
    ...r,
    assets: r.assets.map((a) => ({ ...a, tokenContractAddress: a.tokenContractAddress.toLowerCase() as `0x${string}` })),
  }));
}

/** Company profile and protections. Shape is nullable-heavy and only shown, never computed on, so it stays `unknown`. */
export async function rwaProfile(addr: `0x${string}`): Promise<unknown> {
  return web3Request<unknown>("GET", "/api/v1/dex/market/rwa/underlying-profile", {
    binanceChainId: BINANCE_CHAIN_ID,
    tokenContractAddress: addr,
  });
}
