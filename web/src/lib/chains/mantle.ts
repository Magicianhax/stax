// Mantle mainnet (chainId 5000) — the original Stax chain, kept as a secondary mode.
// Every address below was verified on-chain on 2026-06-01. See ../../../docs/SPEC.md (§3, §14).
import { defineChain } from "viem";
import type { Asset, AssetRoute, StaxChain } from "./types";

const RPC_URL = process.env.NEXT_PUBLIC_MANTLE_RPC_URL || "https://rpc.mantle.xyz";
const RPC_FALLBACKS = ["https://mantle-rpc.publicnode.com", "https://mantle.drpc.org", "https://rpc.mantle.xyz"].filter((u) => u !== RPC_URL);
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const mantleChain = defineChain({
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Mantlescan", url: "https://mantlescan.xyz" } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

const USDC_ADDR = "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9" as const;

// Fluxion universal router — settlement venue for the wrapped xStocks (USDC pairs, fee tier 3000).
export const FLUXION_ROUTER = "0x5628a59dF0ECAC3f3171f877A94bEb26BA6DFAa0" as const;
// Agni Finance router (Uniswap-V3 ISwapRouter fork) — SAFE/CRYPTO multi-hop legs.
export const AGNI_ROUTER = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421" as const;
// Merchant Moe LBRouter — only USDC->FBTC venue; not hand-buildable safely, so FBTC stays gated.
export const MERCHANT_MOE_ROUTER = "0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a" as const;

export const USDE = "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34" as const;
export const WETH = "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111" as const;
const SUSDE = "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2" as const;
const METH = "0xcDA86A272531e8640cD7F1a92c01839911B90bb0" as const;
const USDT = "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE" as const;

// Wrapped Backed xStocks (wAAPLx, ...), USDC-paired on Fluxion.
const STOCKS: Asset[] = [
  { symbol: "AAPL",  name: "Apple",          tier: "stock", address: "0x5aa7649fdbda47de64a07ac81d64b682af9c0724", pool: "0x2cc6A607F3445d826B9E29f507B3A2E3B9dae106", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wAAPLx" },
  { symbol: "TSLA",  name: "Tesla",          tier: "stock", address: "0x43680abf18cf54898be84c6ef78237cfbd441883", pool: "0x5E7935d70b5d14b6Cf36fbde59944533FAb96B3C", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wTSLAx" },
  { symbol: "NVDA",  name: "Nvidia",         tier: "stock", address: "0x93e62845c1dd5822ebc807ab71a5fb750decd15a", pool: "0xa875ac23d106394d1baaae5bc42b951268bc04e2", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wNVDAx" },
  { symbol: "GOOGL", name: "Alphabet",       tier: "stock", address: "0x1630f08370917e79df0b7572395a5e907508bbbc", pool: "0x66960ed892daf022c5f282c5316c38cb6f0c1333", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wGOOGLx" },
  { symbol: "META",  name: "Meta",           tier: "stock", address: "0x4e41a262caa93c6575d336e0a4eb79f3c67caa06", pool: "0x782bd3895a6ac561d0df11b02dd6f9e023f3a497", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wMETAx" },
  { symbol: "MSTR",  name: "Strategy",       tier: "stock", address: "0x266e5923f6118f8b340ca5a23ae7f71897361476", pool: "0x0e1f84a9e388071e20df101b36c14c817bf81953", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wMSTRx" },
  { symbol: "HOOD",  name: "Robinhood",      tier: "stock", address: "0x953707d7a1cb30cc5c636bda8eaebe410341eb14", pool: "0x4e23bb828e51cbc03c81d76c844228cc75f6a287", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wHOODx" },
  { symbol: "CRCL",  name: "Circle",         tier: "stock", address: "0xa90872aca656ebe47bdebf3b19ec9dd9c5adc7f8", pool: "0x43cf441f5949d52faa105060239543492193c87e", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wCRCLx" },
  { symbol: "SPY",   name: "S&P 500 ETF",    tier: "stock", address: "0xc88fcd8b874fdb3256e8b55b3decb8c24eab4c02", pool: "0x373f7a2b95f28f38500eb70652e12038cca3bab8", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wSPYx" },
  { symbol: "QQQ",   name: "Nasdaq 100 ETF", tier: "stock", address: "0xdbd9232fee15351068fe02f0683146e16d9f2cea", pool: "0x505258001e834251634029742fc73b5cab4fd67d", feeTier: 3000, decimals: 18, via: "fluxion", onchainSymbol: "wQQQx" },
];

const SAFE: Asset[] = [
  // sUSDe is disabled: the Agni USDe/sUSDe pool was drained to zero liquidity (see git e98d496).
  // The route below is kept so existing holders can still SELL.
  { symbol: "sUSDe", name: "Staked Ethena USD (real yield)", tier: "safe", address: SUSDE, decimals: 18, via: "agni", coming: true, venue: "Ethena" },
  // Ondo USDY / mUSD: real on Mantle but KYC mint only, no liquid USDC route → listed-only.
  { symbol: "USDY",  name: "Ondo US Dollar Yield", tier: "safe", venue: "Ondo", address: "0x5bE26527e817998A7206475496fDE1E68957c5A6", decimals: 18, via: "route", coming: true },
  { symbol: "mUSD",  name: "Mantle USD (Ondo)",    tier: "safe", venue: "Ondo", address: "0xab575258d37EaA5C8956EfABe71F4eE8F6397cF3", decimals: 18, via: "route", coming: true },
];

const CRYPTO: Asset[] = [
  { symbol: "mETH", name: "Mantle Staked ETH",  tier: "crypto", address: METH, decimals: 18, via: "agni" },
  { symbol: "FBTC", name: "Bitcoin (Function)", tier: "crypto", address: "0xC96dE26018A54D51c097160568752c4E3BD6C364", decimals: 8, via: "merchant_moe", coming: true },
];

/**
 * VERIFIED Agni routes (2026-06-01). Each is a SINGLE Agni `exactInput` call delivering the
 * final token to the recipient. sUSDe is kept for the sell path of existing holders only.
 */
const ROUTES: Record<string, AssetRoute> = {
  sUSDe: {
    router: AGNI_ROUTER,
    kind: "agni_v3",
    hops: [
      { tokenIn: USDC_ADDR, tokenOut: USDE, fee: 100, pool: "0xBCf99c834E65E8a58090E20eDc058279317865BD", tokenInDecimals: 6, tokenOutDecimals: 18 },
      { tokenIn: USDE, tokenOut: SUSDE, fee: 500, pool: "0x07277F7c1567b5324aA50a3d2F1F003E2287fBfc", tokenInDecimals: 18, tokenOutDecimals: 18 },
    ],
  },
  mETH: {
    router: AGNI_ROUTER,
    kind: "agni_v3",
    hops: [
      { tokenIn: USDC_ADDR, tokenOut: USDT, fee: 100, pool: "0x6488f911c6Cd86c289aa319C5A826Dcf8F1cA065", tokenInDecimals: 6, tokenOutDecimals: 6 },
      { tokenIn: USDT, tokenOut: METH, fee: 2500, pool: "0x551D49F0a9C3D5293293E12f36b210e0124dD4E7", tokenInDecimals: 6, tokenOutDecimals: 18 },
    ],
  },
};

const ALL = [...STOCKS, ...SAFE, ...CRYPTO];

export const MANTLE: StaxChain = {
  key: "mantle",
  id: 5000,
  name: "Mantle",
  chain: mantleChain,
  rpcUrl: RPC_URL,
  rpcFallbacks: RPC_FALLBACKS,
  explorer: { name: "Mantlescan", url: "https://mantlescan.xyz" },
  etherscanChainId: 5000,
  blockscoutUrl: "https://explorer.mantle.xyz",
  nativeSymbol: "MNT",
  usdc: { address: USDC_ADDR, symbol: "USDC", decimals: 6 },
  multicall3: MULTICALL3,
  contracts: {
    executor: (process.env.NEXT_PUBLIC_STAX_EXECUTOR || "0x3411196abdc3dbe59c5e2878c44d1931a975af12") as `0x${string}`,
    verifier: (process.env.NEXT_PUBLIC_INFERENCE_VERIFIER || "0x1eba56412e02a88f17a7dfa878494b3dfd4e0d1b") as `0x${string}`,
    registry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY || "0x9f147a87f131408dd0bd750c16ac782620572abf") as `0x${string}`,
    agentId: BigInt(process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1"),
    executorBlock: BigInt(process.env.NEXT_PUBLIC_STAX_EXECUTOR_BLOCK || "96098605"),
    deployed: true,
  },
  routers: {
    v3: FLUXION_ROUTER,
    v3Kind: "fluxion",
    all: [FLUXION_ROUTER, AGNI_ROUTER, MERCHANT_MOE_ROUTER],
  },
  assets: { stocks: STOCKS, safe: SAFE, crypto: CRYPTO, all: ALL },
  routes: ROUTES,
  brand: { tagline: "on Mantle", logo: "/brand/partners/mantle.png", accent: "#65B3AE" },
  issuer: "Backed xStocks",
};
