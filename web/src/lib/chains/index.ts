// Stax multi-chain registry. Base is the default; Mantle is the legacy mode; BSC is the BNB Hack chain.
//
//   import { getChain, DEFAULT_CHAIN_KEY, isRoutable } from "@/lib/chains";
//   client components:  const chain = useChain();            (@/lib/chains/active)
//   server routes:      const chain = chainFromRequest(req);  (@/lib/server/chain)
export * from "./types";
import { fallback, http, type Transport } from "viem";
import { BASE } from "./base";
import { BSC } from "./bsc";
import { MANTLE } from "./mantle";
import type { Asset, ChainKey, RouteHop, StaxChain } from "./types";

export const CHAINS: Record<ChainKey, StaxChain> = { base: BASE, mantle: MANTLE, bsc: BSC };
export const CHAIN_KEYS: ChainKey[] = ["base", "mantle", "bsc"];
export const DEFAULT_CHAIN_KEY: ChainKey = "base";

/** Request header clients send so API routes know which chain to act on. */
export const CHAIN_HEADER = "x-stax-chain";

export function isChainKey(v: unknown): v is ChainKey {
  return v === "base" || v === "mantle" || v === "bsc";
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
  // BSC: every listed, non-coming stock with an address routes through the Binance aggregator.
  if (a.via === "binance") return Boolean(chain.routers.binance && a.address);
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
  // Server-only keyed endpoint (BASE_RPC_URL / MANTLE_RPC_URL) goes first: it
  // never ships to the browser, so a CDP/Alchemy token can't be lifted from the
  // bundle. The client keeps the public NEXT_PUBLIC_* / fallback order.
  const urls = [...serverRpcUrls(chain), chain.rpcUrl, ...chain.rpcFallbacks].filter((u, i, a) => a.indexOf(u) === i);
  return fallback(
    urls.map((u) => http(u, { timeout: 12_000, retryCount: 1 })),
    { rank: false, retryCount: 0 },
  );
}

/** The keyed, server-only RPC for `chain`, if configured. Undefined in the browser. */
export function serverRpcUrl(chain: StaxChain): string | undefined {
  return serverRpcUrls(chain)[0];
}

/**
 * Every keyed, server-only endpoint for `chain`, best first. These never reach
 * the browser, so the tokens in them cannot be lifted from the bundle.
 *
 * Dwellir sits behind the primary as a second keyed node: its free plan answers
 * ordinary reads but refuses `eth_getLogs`, so it is a fallback for balances and
 * prices, never for history.
 */
export function serverRpcUrls(chain: StaxChain): string[] {
  if (typeof window !== "undefined") return [];
  const primary = {
    base: process.env.BASE_RPC_URL,
    mantle: process.env.MANTLE_RPC_URL,
    bsc: process.env.BSC_RPC_URL,
  }[chain.key]?.trim();
  // Accept either spelling: the dashboard hands the key over in lower case.
  const dwellir = (process.env.DWELLIR_API_KEY || process.env.dwellir_API_KEY)?.trim();
  const dwellirUrl =
    dwellir && chain.key === "base" ? `https://api-base-mainnet-archive.n.dwellir.com/${dwellir}` : undefined;
  return [primary, dwellirUrl].filter((u): u is string => Boolean(u));
}

export { BASE, MANTLE, BSC };
