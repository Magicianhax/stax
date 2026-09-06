// Stax multi-chain registry. Base is the default; Mantle is the legacy mode.
//
//   import { getChain, DEFAULT_CHAIN_KEY, isRoutable } from "@/lib/chains";
//   client components:  const chain = useChain();            (@/lib/chains/active)
//   server routes:      const chain = chainFromRequest(req);  (@/lib/server/chain)
export * from "./types";
import { fallback, http, type Transport } from "viem";
import { BASE } from "./base";
import { MANTLE } from "./mantle";
import type { Asset, ChainKey, RouteHop, StaxChain } from "./types";

export const CHAINS: Record<ChainKey, StaxChain> = { base: BASE, mantle: MANTLE };
export const CHAIN_KEYS: ChainKey[] = ["base", "mantle"];
export const DEFAULT_CHAIN_KEY: ChainKey = "base";

/** Request header clients send so API routes know which chain to act on. */
export const CHAIN_HEADER = "x-stax-chain";

export function isChainKey(v: unknown): v is ChainKey {
  return v === "base" || v === "mantle";
}

export function getChain(key?: ChainKey | string | null): StaxChain {
  return isChainKey(key) ? CHAINS[key] : CHAINS[DEFAULT_CHAIN_KEY];
}

export function chainById(id: number): StaxChain | undefined {
  return CHAIN_KEYS.map((k) => CHAINS[k]).find((c) => c.id === id);
}

export function assetBySymbol(chain: StaxChain, symbol: string): Asset | undefined {
  return chain.assets.all.find((a) => a.symbol === symbol);
}

/** True if `symbol` is buyable through the executor / manual buy on this chain. */
export function isRoutable(chain: StaxChain, symbol: string): boolean {
  const a = assetBySymbol(chain, symbol);
  if (!a || a.coming) return false;
  if (a.via === "aave_v3") return Boolean(chain.routers.aavePool);
  // Aggregator chains (Base): every listed, non-coming asset with an address routes via Kyber.
  if (chain.routers.kyber && a.address && a.via !== "route") return true;
  if (a.pool && a.feeTier !== undefined) return true; // single-hop V3 (Mantle Fluxion)
  return Boolean(chain.routes[symbol]);
}

/** Assets the AI may allocate into on this chain (routable, not "coming"). */
export function investableAssets(chain: StaxChain): Asset[] {
  return chain.assets.all.filter((a) => isRoutable(chain, a.symbol));
}

/** Reverse a buy route (USDC -> ... -> asset) into its sell direction. V3 pools are symmetric. */
export function reverseRoute(hops: RouteHop[]): RouteHop[] {
  return [...hops].reverse().map((h) => ({
    tokenIn: h.tokenOut,
    tokenOut: h.tokenIn,
    fee: h.fee,
    pool: h.pool,
    tokenInDecimals: h.tokenOutDecimals,
    tokenOutDecimals: h.tokenInDecimals,
  }));
}

/**
 * HTTP transport for a chain: the configured primary first, then the public fallbacks.
 * `rank: false` keeps the order deterministic (primary stays primary); viem retries the
 * next endpoint on HTTP/RPC errors such as "over rate limit".
 */
export function chainTransport(chain: StaxChain): Transport {
  const urls = [chain.rpcUrl, ...chain.rpcFallbacks];
  return fallback(
    urls.map((u) => http(u, { timeout: 12_000, retryCount: 1 })),
    { rank: false, retryCount: 0 },
  );
}

export { BASE, MANTLE };
