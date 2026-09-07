// Base mainnet (chainId 8453) — the primary Stax chain.
// Assets are Coinbase-issued tokenized stocks (B20 standard, 8 decimals, permissionless
// secondary trading; KYC only at AP mint/redeem). Every address + pool below was verified
// on-chain on 2026-09-05 (see tasks/todo.md for the liquidity snapshot).
//
// B20 note: `balanceOf` is a raw balance; one token equals `multiplier()/1e18` shares.
// Today multiplier == 1e18, so 1 token == 1 share. Corporate actions can change that;
// the Chainlink feeds already publish the multiplier-adjusted (total-return) price.
import { base as baseViem } from "viem/chains";
import { defineChain } from "viem";
import type { Asset, StaxChain } from "./types";

// Primary RPC: set NEXT_PUBLIC_BASE_RPC_URL to a keyed endpoint. Coinbase's CDP Node
// (https://api.developer.coinbase.com/rpc/v1/base/<key>) is free and generous for Base.
// The public endpoints below are rotated in on errors / rate limits (viem `fallback`).
const RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const RPC_FALLBACKS = ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"].filter((u) => u !== RPC_URL);
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const baseChain = defineChain({
  ...baseViem,
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { ...baseViem.contracts, multicall3: { address: MULTICALL3 } },
});

export const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

// Uniswap V3 on Base (docs.uniswap.org/contracts/v3/reference/deployments/base-deployments).
// SwapRouter02: exactInputSingle/exactInput WITHOUT a deadline field (use `multicall(deadline, ...)`
// if a deadline is ever needed). factory() and WETH9() read-verified 2026-09-05.
export const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as const;
export const UNISWAP_ROUTER02 = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
// KyberSwap MetaAggregationRouterV2 — the aggregator venue on Base (Aerodrome + Aerodrome CL + Uniswap V3 …).
// Whitelisted on the executor alongside Router02 (kept as a fallback). Code verified on Base 2026-09-06.
export const KYBER_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" as const;
export const UNISWAP_QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const;
// Aave v3 Pool on Base — the "safe dollars" venue: supply(USDC) → aBasUSDC (~3.8% APY on 2026-09-05).
export const AAVE_V3_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as const;
export const A_BAS_USDC = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB" as const;
export const WETH = "0x4200000000000000000000000000000000000006" as const;
export const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as const;

// Coinbase tokenized stocks registry: B20Created events announce new tokens.
export const COINBASE_STOCK_REGISTRY = "0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD" as const;

// Every buyable asset swaps through the KyberSwap aggregator (`via: "kyber"`), which routes
// across Aerodrome / Aerodrome CL / Uniswap v3+v4. `pool` (when present) is the deepest direct
// USDC Uniswap V3 pool: it stays as the Router02 fallback leg and the slot0 price source;
// assets without a pool are priced off a Kyber 100-USDC route.
const STOCKS: Asset[] = [
  { symbol: "NVDA",  name: "Nvidia",    tier: "stock", address: "0xb20000000000000000000078ee7ce2fE4908108C", pool: "0x60661b315553EB81872deEA9a66d567Cf0CCd33B", feeTier: 3000,  decimals: 8, via: "kyber", onchainSymbol: "NVDAc",  priceFeed: "0x04689a41629776563E6822F76f2e57D148d28513" },
  { symbol: "GOOGL", name: "Alphabet",  tier: "stock", address: "0xb2000000000000000000002D0BA3164cc74f58B7", pool: "0x1f52F46BaC657564c31122b12b43A459E09273C8", feeTier: 10000, decimals: 8, via: "kyber", onchainSymbol: "GOOGLc", priceFeed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2" },
  { symbol: "AAPL",  name: "Apple",     tier: "stock", address: "0xb200000000000000000000C2e324d24d7eEcd1fb", pool: "0x97F35d1E92795327614BE000cd18cba1Be2c1931", feeTier: 3000,  decimals: 8, via: "kyber", onchainSymbol: "AAPLc",  priceFeed: "0x787f13dEa48Db0897CbCDD985de77809D837F988" },
  { symbol: "META",  name: "Meta",      tier: "stock", address: "0xb2000000000000000000008bC8786B856E61707C", pool: "0x583919ec1975a1238C50e1940911894ee6912476", feeTier: 3000,  decimals: 8, via: "kyber", onchainSymbol: "METAc",  priceFeed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D" },
  { symbol: "SPCX",  name: "SpaceX",    tier: "stock", address: "0xb2000000000000000000007b9fcbd005511aCBd5", pool: "0x127a12FC0953ab2ab89558c67Ba6D597D7140431", feeTier: 10000, decimals: 8, via: "kyber", onchainSymbol: "SPCXc",  priceFeed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68" },
  // No direct USDC Uniswap V3 pool, but Kyber routes them (Aerodrome CL / Uniswap v4, verified 2026-09-06).
  { symbol: "TSLA",  name: "Tesla",     tier: "stock", address: "0xb2000000000000000000001e800a7f5189430cD0", decimals: 8, via: "kyber", onchainSymbol: "TSLAc", priceFeed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" },
  { symbol: "AMZN",  name: "Amazon",    tier: "stock", address: "0xb200000000000000000000d9192b6B456483C2E8", decimals: 8, via: "kyber", onchainSymbol: "AMZNc", priceFeed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" },
  { symbol: "MSFT",  name: "Microsoft", tier: "stock", address: "0xB200000000000000000000Ab99cFa739E253872B", decimals: 8, via: "kyber", onchainSymbol: "MSFTc", priceFeed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c" },
  { symbol: "MSTR",  name: "Strategy",  tier: "stock", address: "0xb2000000000000000000004884b426556b92883d", decimals: 8, via: "kyber", onchainSymbol: "MSTRc", priceFeed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a" },
  // Not minted by Coinbase yet (Kyber: "route not found" on 2026-09-06) → coming soon.
  { symbol: "COIN",  name: "Coinbase",  tier: "stock", address: "0xb200000000000000000000c85a31389D71F3ecfb", decimals: 8, via: "kyber", onchainSymbol: "COINc", priceFeed: "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7", coming: true },
  { symbol: "CRCL",  name: "Circle",    tier: "stock", address: "0xB20000000000000000000019f6E7C675b73C2e4D", decimals: 8, via: "kyber", onchainSymbol: "CRCLc", priceFeed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33", coming: true },
];

const SAFE: Asset[] = [
  // Aave v3 USDC deposit. Buy = Pool.supply(USDC, amt, recipient, 0) → aBasUSDC (rebasing, 6 dec).
  // Sell = Pool.withdraw(USDC, amt, recipient) from the user's own account.
  { symbol: "aUSDC", name: "Safe Dollars (Aave)", tier: "safe", address: A_BAS_USDC, decimals: 6, via: "aave_v3", onchainSymbol: "aBasUSDC", venue: "Aave" },
];

const CRYPTO: Asset[] = [
  { symbol: "BTC", name: "Bitcoin (cbBTC)", tier: "crypto", address: CBBTC, pool: "0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef", feeTier: 500, decimals: 8,  via: "kyber", onchainSymbol: "cbBTC" },
  { symbol: "ETH", name: "Ethereum",        tier: "crypto", address: WETH,  pool: "0xd0b53D9277642d899DF5C87A3966A349A798F224", feeTier: 500, decimals: 18, via: "kyber", onchainSymbol: "WETH" },
];

const ALL = [...STOCKS, ...SAFE, ...CRYPTO];

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const executor = (process.env.NEXT_PUBLIC_STAX_EXECUTOR_BASE || ZERO_ADDR) as `0x${string}`;

export const BASE: StaxChain = {
  key: "base",
  id: 8453,
  name: "Base",
  chain: baseChain,
  rpcUrl: RPC_URL,
  rpcFallbacks: RPC_FALLBACKS,
  explorer: { name: "Basescan", url: "https://basescan.org" },
  etherscanChainId: 8453,
  blockscoutUrl: "https://base.blockscout.com",
  nativeSymbol: "ETH",
  usdc: { address: USDC_ADDR, symbol: "USDC", decimals: 6 },
  multicall3: MULTICALL3,
  // Filled by `contracts/scripts/deploy-base.js` → web/.env.local. Until then `deployed` is false
  // and the UI shows a friendly "Base launching" state instead of failing calls.
  contracts: {
    executor,
    verifier: (process.env.NEXT_PUBLIC_INFERENCE_VERIFIER_BASE || ZERO_ADDR) as `0x${string}`,
    registry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_BASE || ZERO_ADDR) as `0x${string}`,
    agentId: BigInt(process.env.NEXT_PUBLIC_STAX_AGENT_ID_BASE || "1"),
    executorBlock: BigInt(process.env.NEXT_PUBLIC_STAX_EXECUTOR_BLOCK_BASE || "0"),
    deployed: executor !== ZERO_ADDR,
  },
  routers: {
    v3: UNISWAP_ROUTER02,
    v3Kind: "uniswap_v3",
    quoterV2: UNISWAP_QUOTER_V2,
    aavePool: AAVE_V3_POOL,
    kyber: KYBER_ROUTER,
    all: [KYBER_ROUTER, UNISWAP_ROUTER02, AAVE_V3_POOL],
  },
  assets: { stocks: STOCKS, safe: SAFE, crypto: CRYPTO, all: ALL },
  routes: {},
  brand: { tagline: "on Base", logo: "/brand/partners/base.svg", accent: "#0052FF" },
  issuer: "Coinbase tokenized stocks",
};
