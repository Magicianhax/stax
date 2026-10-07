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

/**
 * Per-address cache for `balancesBatched` + `rawBalanceMap`, so a user re-polling the portfolio
 * doesn't redraw the shared 5-per-window Binance budget every few seconds.
 *
 * Review fix (wave 5b): the TTL used to be 10s, shorter than `usePortfolio`'s 30s
 * `refetchInterval`, so every poll missed the cache anyway and still spent ~5 calls (plus queue
 * wait) in front of swap-quote, price checks and dry-runs. 45s covers the poll interval with
 * margin either side of the tick. `invalidateBscBalanceCache` exists for a caller that just
 * confirmed a balance-changing send (a trade or a Savings move) landed and wants the NEXT read to
 * be fresh rather than waiting out the window — this module doesn't call it itself, since it has
 * no visibility into when a send lands; the executor/swap paths do.
 */
export const BSC_BALANCE_CACHE_TTL_MS = 45_000;
const balanceCache = new Map<string, { at: number; value: Promise<Map<string, bigint>> }>();

export function cachedBscBalances(address: `0x${string}`, tokenAddresses: `0x${string}`[]): Promise<Map<string, bigint>> {
  const key = address.toLowerCase();
  const hit = balanceCache.get(key);
  if (hit && Date.now() - hit.at < BSC_BALANCE_CACHE_TTL_MS) return hit.value;
  const value = balancesBatched(address, tokenAddresses).then(rawBalanceMap);
  balanceCache.set(key, { at: Date.now(), value });
  value.catch(() => balanceCache.delete(key)); // don't let a failure poison later polls
  return value;
}

/**
 * Drops one address's cached balances so the next read is forced fresh — call after a send that
 * changes it lands (a trade or a Savings deposit/redeem), rather than waiting out the TTL.
 * `minAgeMs` keeps a client from draining the shared Binance budget: an entry younger than that is
 * left alone, so one address costs at most one fresh Wallet API read per `minAgeMs`.
 */
export function invalidateBscBalanceCache(address: `0x${string}`, minAgeMs = 0): void {
  const key = address.toLowerCase();
  const hit = balanceCache.get(key);
  if (hit && Date.now() - hit.at < minAgeMs) return;
  balanceCache.delete(key);
}
