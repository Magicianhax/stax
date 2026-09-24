import "server-only";

// The Wallet API, prefix /api/v1/dex (docs/BINANCE-WEB3.md §6). The POST body's nested shape
// (`tokenContractAddresses: [{ binanceChainId, tokenContractAddress }]`) is the one that works;
// research tried three flatter shapes first and every one failed with the generic 40001.
import { z } from "zod";
import { web3Request } from "./client";
import { BinanceWeb3Error } from "./types";
import type { TokenAsset } from "./types";

const BINANCE_CHAIN_ID = "56";

const wireTokenAsset = z.object({
  binanceChainId: z.string(),
  tokenContractAddress: z.string(),
  address: z.string(),
  symbol: z.string(),
  balance: z.string(),
  rawBalance: z.string(),
  tokenPrice: z.string(),
  isRiskToken: z.boolean(),
});

const wireBalancesResponse = z.array(z.object({ tokenAssets: z.array(wireTokenAsset) }));

/** At most 20 tokens per call (docs/BINANCE-WEB3.md §6); refused before Binance sees it. */
export async function balances(address: `0x${string}`, tokens: `0x${string}`[]): Promise<TokenAsset[]> {
  if (tokens.length > 20) throw new Error(`balances: at most 20 tokens per call, got ${tokens.length}`);
  const data = await web3Request<unknown>(
    "POST",
    "/api/v1/dex/balance/token-balances-by-address",
    {},
    { address, tokenContractAddresses: tokens.map((t) => ({ binanceChainId: BINANCE_CHAIN_ID, tokenContractAddress: t })) },
  );
  const parsed = wireBalancesResponse.safeParse(data);
  if (!parsed.success || parsed.data.length === 0) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/balance/token-balances-by-address", 200);
  }
  return parsed.data[0].tokenAssets.map((a) => ({
    binanceChainId: a.binanceChainId,
    tokenContractAddress: a.tokenContractAddress,
    address: a.address,
    symbol: a.symbol,
    balance: a.balance,
    rawBalance: BigInt(a.rawBalance),
    tokenPrice: a.tokenPrice === "" ? null : Number(a.tokenPrice),
    isRiskToken: a.isRiskToken,
  }));
}

const BALANCES_CHUNK = 20;

/**
 * `balances()` caps at 20 tokens per call (Binance's own limit); the BSC portfolio's candidate
 * address list (42 stocks + most twins + 3 crypto, ~85 addresses) is well past that, so this
 * chunks it into serial calls and merges the rows back in request order. Serial, not
 * `Promise.all`, because `web3Request` already funnels every call through one process-wide
 * rate-limited queue (`rateLimit.ts`) — firing the chunks concurrently would just make them wait
 * on each other anyway, with none of the readability of doing it in order.
 */
export async function balancesBatched(address: `0x${string}`, tokens: `0x${string}`[]): Promise<TokenAsset[]> {
  const out: TokenAsset[] = [];
  for (let i = 0; i < tokens.length; i += BALANCES_CHUNK) {
    const chunk = tokens.slice(i, i + BALANCES_CHUNK);
    out.push(...(await balances(address, chunk)));
  }
  return out;
}

/**
 * Lowercase-address -> raw balance, for a caller that wants to look up several addresses out of
 * one `balances`/`balancesBatched` result. An address Binance's response never mentioned is
 * simply absent (not 0n) — callers that want "not held reads as zero" (matching an RPC
 * `balanceOf`'s behaviour) do that at the lookup site, so a genuinely missing/errored read can't
 * be silently confused with a real zero balance here.
 */
export function rawBalanceMap(assets: TokenAsset[]): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const a of assets) map.set(a.tokenContractAddress.toLowerCase(), a.rawBalance);
  return map;
}
