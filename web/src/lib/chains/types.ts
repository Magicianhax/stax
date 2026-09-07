// Chain-agnostic shapes for the Stax multi-chain registry.
// One `StaxChain` per supported network (Base = default, Mantle = legacy).
import type { Chain } from "viem";

export type ChainKey = "base" | "mantle";

export type AssetTier = "stock" | "safe" | "crypto";

/**
 * How a leg / manual buy for an asset is executed:
 *  - "fluxion"     Mantle Fluxion universal router, single-hop exactInputSingle (has `deadline`)
 *  - "agni"        Mantle Agni ISwapRouter fork, multi-hop exactInput(path) (has `deadline`)
 *  - "uniswap_v3"  Uniswap SwapRouter02 (Base), exactInputSingle / exactInput — NO `deadline` field
 *  - "aave_v3"     Aave v3 Pool.supply(USDC) → aToken (Base "safe dollars"); sell = Pool.withdraw
 *  - "kyber"       KyberSwap Aggregator (Base): server-built calldata for MetaAggregationRouterV2
 *                  (`chain.routers.kyber`); `pool`/`feeTier` kept as the Router02 fallback + price source
 *  - "merchant_moe" Mantle LB router (recorded, not routable)
 *  - "route"       listed only, no permissionless route (shown as "coming soon")
 */
export type SwapVia = "fluxion" | "agni" | "uniswap_v3" | "aave_v3" | "kyber" | "merchant_moe" | "route";

export interface Asset {
  symbol: string; // user-facing ticker, shared across chains ("AAPL" on both Base and Mantle)
  name: string;
  tier: AssetTier;
  address?: `0x${string}`; // token address on this chain
  /** Where the yield comes from, for the safe tier's tag ("Aave", "Ethena", "Ondo"). */
  venue?: string;
  pool?: `0x${string}`; // single-hop USDC pool (V3) — present ⇒ single-hop buy on `chain.routers.v3`
  feeTier?: number; // V3 fee tier for `pool`
  decimals?: number;
  via: SwapVia;
  /** Listed for visibility but not buyable yet (no liquid permissionless route). */
  coming?: boolean;
  /** Optional Chainlink-style AggregatorV3 feed (8 dec) for a reference market price. */
  priceFeed?: `0x${string}`;
  /** Optional on-chain ticker when it differs from `symbol` (e.g. "AAPLc", "wAAPLx"). */
  onchainSymbol?: string;
}

/** One hop of a V3 route, with the pool we read for spot pricing. */
export interface RouteHop {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  pool: `0x${string}`;
  tokenInDecimals: number;
  tokenOutDecimals: number;
}

/** A validated multi-hop swap route (USDC -> ... -> final asset) on a single router. */
export interface AssetRoute {
  router: `0x${string}`;
  kind: "agni_v3" | "uniswap_v3";
  hops: RouteHop[];
}

export interface StaxContracts {
  executor: `0x${string}`;
  verifier: `0x${string}`;
  registry: `0x${string}`;
  /** ERC-8004 agentId of Vera on this chain. */
  agentId: bigint;
  /** Block the executor was deployed at — lower bound for event scans. */
  executorBlock: bigint;
  /** True when the addresses above are real deployments (not placeholders). */
  deployed: boolean;
}

export interface StaxChain {
  key: ChainKey;
  id: number;
  name: string; // "Base" | "Mantle"
  /** viem Chain (with multicall3) for clients + permissionless. */
  chain: Chain;
  rpcUrl: string;
  /** Ordered fallbacks tried when `rpcUrl` errors or rate-limits (viem `fallback` transport). */
  rpcFallbacks: string[];
  explorer: { name: string; url: string };
  /** Etherscan V2 `chainid` param for account/tokentx history. */
  etherscanChainId: number;
  /** Blockscout instance (Etherscan-compatible `?module=account&action=tokentx`), the
   *  no-key history fallback for chains Etherscan's free tier refuses (Base). */
  blockscoutUrl?: string;
  nativeSymbol: string;
  usdc: { address: `0x${string}`; symbol: "USDC"; decimals: 6 };
  multicall3: `0x${string}`;
  contracts: StaxContracts;
  routers: {
    /** Single-hop V3 router for `pool`-bearing assets. */
    v3: `0x${string}`;
    v3Kind: "fluxion" | "uniswap_v3";
    /** Uniswap QuoterV2 when available (Base) — exact quotes incl. price impact. */
    quoterV2?: `0x${string}`;
    /** Aave v3 Pool when the safe tier is an aToken (Base). */
    aavePool?: `0x${string}`;
    /** KyberSwap MetaAggregationRouterV2 when the chain swaps through the aggregator (Base). */
    kyber?: `0x${string}`;
    /** Every router the executor must whitelist (deploy script + docs). */
    all: `0x${string}`[];
  };
  assets: {
    stocks: Asset[];
    safe: Asset[];
    crypto: Asset[];
    all: Asset[];
  };
  /** Multi-hop routes keyed by `symbol` (Mantle sUSDe / mETH). */
  routes: Record<string, AssetRoute>;
  /** Marketing / UI. */
  brand: {
    tagline: string; // "on Base"
    logo: string; // public path
    accent: string; // hex
  };
  /** Human note on the asset issuer shown in Help / Market. */
  issuer: string;
}

export function explorerTx(chain: StaxChain, hash: string): string {
  return `${chain.explorer.url}/tx/${hash}`;
}
export function explorerAddress(chain: StaxChain, address: string): string {
  return `${chain.explorer.url}/address/${address}`;
}
