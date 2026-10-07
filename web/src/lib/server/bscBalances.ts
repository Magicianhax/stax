import "server-only";

// The merged balance read /api/portfolio uses (Binance's Wallet API first, RPC as the fallback
// and gap-filler), factored out so lib/server/bscHoldings.ts (the rule engine's holdings reader)
// reads exactly the same way instead of re-implementing — and mis-implementing — its own version.
// Moving this out changes nothing about how either caller behaves: it's the same two functions
// and the same merge order the portfolio route used inline before this file existed.
import type { PublicClient } from "viem";
import { ERC20_ABI } from "@/lib/abis";
import type { StaxChain } from "@/lib/chains/types";
import { cachedBscBalances, invalidateBscBalanceCache } from "./binance/wallet";

/** How old a cached read must be before `fresh` may replace it (one fresh Binance read per address per 2 s). */
export const FRESH_BALANCE_MIN_AGE_MS = 2_000;

/**
 * BSC's raw token balances via the Binance Wallet API (one batched read across every candidate
 * address) instead of a per-token RPC `balanceOf`. Caching lives in wallet.ts
 * (`cachedBscBalances`), shared with anything else that ever needs a BSC balance read. Returns
 * `null` on ANY failure (bad shape, timeout, rate limit) so the caller falls back to the RPC
 * multicall below and never goes blank for a Binance hiccup.
 */
async function bscRawBalances(
  chain: StaxChain,
  address: `0x${string}`,
  tokenAddresses: `0x${string}`[],
  fresh = false,
): Promise<Map<string, bigint> | null> {
  if (chain.key !== "bsc") return null;
  try {
    if (fresh) invalidateBscBalanceCache(address, FRESH_BALANCE_MIN_AGE_MS);
    return await cachedBscBalances(address, tokenAddresses);
  } catch (err) {
    console.warn("[bscBalances] Binance Wallet API balances unavailable, falling back to RPC:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Plain RPC `balanceOf` for exactly the addresses passed in, merged into a lowercase-address ->
 * raw balance map. Used two ways: as the full fallback when Binance is unavailable at all, and to
 * backfill just the addresses Binance's response left out. A read that fails here too (reverted,
 * or the address just isn't in the response) is left out of the returned map — the caller already
 * treats "absent" as "not held".
 */
async function rpcBalancesFor(client: PublicClient, address: `0x${string}`, tokenAddresses: `0x${string}`[]): Promise<Map<string, bigint>> {
  const map = new Map<string, bigint>();
  if (tokenAddresses.length === 0) return map;
  const results = await client.multicall({
    contracts: tokenAddresses.map((addr) => ({
      address: addr,
      abi: ERC20_ABI,
      functionName: "balanceOf" as const,
      args: [address] as const,
    })),
  });
  tokenAddresses.forEach((addr, i) => {
    const r = results[i];
    if (r.status === "success") map.set(addr.toLowerCase(), r.result as bigint);
  });
  return map;
}

/**
 * The merged balance map for `readAddresses` on `chain`: BSC's own Wallet API read first, backfilled
 * (never fully replaced) by a targeted RPC read for whichever addresses Binance's response left
 * out or a total RPC read when Binance failed outright. Off BSC, `bscRawBalances` returns `null`
 * immediately so every address goes straight to `rpcBalancesFor`, unchanged from before this chain
 * had its own Wallet API path.
 */
export async function bscBalanceMap(
  chain: StaxChain,
  client: PublicClient,
  address: `0x${string}`,
  readAddresses: `0x${string}`[],
  opts: { fresh?: boolean } = {},
): Promise<Map<string, bigint>> {
  const binanceMap = await bscRawBalances(chain, address, readAddresses, opts.fresh);
  const missing = binanceMap ? readAddresses.filter((a) => !binanceMap.has(a.toLowerCase())) : readAddresses;
  const rpcMap = await rpcBalancesFor(client, address, missing);
  return binanceMap ? new Map([...binanceMap, ...rpcMap]) : rpcMap;
}

/**
 * The cash (USDT) balance straight from the chain. The Binance Wallet API read is cached for
 * ~45 s and also serves the holdings, so right after a trade it still shows the pre-trade cash;
 * an RPC read is current, and it is the same source the Wallet's own cash figure uses (so Home and
 * Wallet agree). Null when the read fails, and the caller keeps the merged map's value.
 */
export async function rpcCashRaw(chain: StaxChain, client: PublicClient, address: `0x${string}`): Promise<bigint | null> {
  if (chain.key !== "bsc") return null;
  try {
    const [r] = await client.multicall({
      contracts: [{ address: chain.usdc.address, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [address] as const }],
    });
    return r.status === "success" ? (r.result as bigint) : null;
  } catch {
    return null;
  }
}
