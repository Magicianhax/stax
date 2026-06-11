// Mantle mainnet config + Stax asset registry (chainId 5000).
// Every address below was verified on-chain on 2026-06-01. See ../../docs/SPEC.md (§3, §14).

export const MANTLE_CHAIN = {
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mantle.xyz"] } },
  blockExplorers: { default: { name: "Mantlescan", url: "https://mantlescan.xyz" } },
} as const;

// Canonical Multicall3 (same address on every EVM chain; code verified on Mantle).
// Server-side viem clients add this to their chain config so `batch.multicall`
// can aggregate read bursts into a single eth_call.
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const USDC = {
  address: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
  symbol: "USDC",
  decimals: 6,
} as const;

// InferenceVerifier (EIP-712) — public contract address, single source of truth.
// Env override wins so a redeploy needs no code change. Kept here (client-safe)
// so server signing code never has to mix a public address read with the key.
export const INFERENCE_VERIFIER = (process.env.NEXT_PUBLIC_INFERENCE_VERIFIER ||
  "0x1eba56412e02a88f17a7dfa878494b3dfd4e0d1b") as `0x${string}`;

// Fluxion universal router — settlement venue for the wrapped xStocks (USDC pairs, fee tier 3000).
export const FLUXION_ROUTER = "0x5628a59dF0ECAC3f3171f877A94bEb26BA6DFAa0" as const;

// Agni Finance router (Uniswap-V3 ISwapRouter fork) — settlement venue for the
// SAFE/CRYPTO multi-hop legs (USDC -> intermediate -> sUSDe / mETH). Verified on
// Mantlescan 2026-06-01 (has exactInput(path)). See lib/legBuilder.ts + ASSET_ROUTES.
export const AGNI_ROUTER = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421" as const;

// Merchant Moe LBRouter (Liquidity Book v2.2, bin-based). The only venue that
// routes USDC -> FBTC (via WMNT), but its bin-path calldata + the executor's
// balance-delta forwarding make a one-call leg risky to hand-build, so FBTC stays
// honestly gated for now. Recorded here so it can be enabled when validated.
export const MERCHANT_MOE_ROUTER = "0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a" as const;

// Intermediate hop tokens (whitelisted on the executor for forward-safety + future routes).
export const USDE = "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34" as const;
export const WETH = "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111" as const;

export type AssetTier = "stock" | "safe" | "crypto";

export interface Asset {
  symbol: string;        // user-facing ticker
  name: string;
  tier: AssetTier;
  address?: `0x${string}`; // token address (some resolved at runtime via the pool)
  pool?: `0x${string}`;    // Fluxion USDC pool (stocks)
  feeTier?: number;        // Fluxion fee tier
  decimals?: number;
  via: "fluxion" | "merchant_moe" | "agni" | "route";
}

// ---- MVP universe: all VERIFIED permissionlessly buyable on Mantle (2026-06-01) ----
// xStocks here are the wrapped Backed tokens (wAAPLx, ...), USDC-paired on Fluxion.
// (The ~92 native Backed xStocks are deployed but NOT permissionlessly buyable yet — roadmap.)
export const STOCKS: Asset[] = [
  { symbol: "AAPL",  name: "Apple",          tier: "stock", address: "0x5aa7649fdbda47de64a07ac81d64b682af9c0724", pool: "0x2cc6A607F3445d826B9E29f507B3A2E3B9dae106", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "TSLA",  name: "Tesla",          tier: "stock", address: "0x43680abf18cf54898be84c6ef78237cfbd441883", pool: "0x5E7935d70b5d14b6Cf36fbde59944533FAb96B3C", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "NVDA",  name: "Nvidia",         tier: "stock", address: "0x93e62845c1dd5822ebc807ab71a5fb750decd15a", pool: "0xa875ac23d106394d1baaae5bc42b951268bc04e2", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "GOOGL", name: "Alphabet",       tier: "stock", address: "0x1630f08370917e79df0b7572395a5e907508bbbc", pool: "0x66960ed892daf022c5f282c5316c38cb6f0c1333", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "META",  name: "Meta",           tier: "stock", address: "0x4e41a262caa93c6575d336e0a4eb79f3c67caa06", pool: "0x782bd3895a6ac561d0df11b02dd6f9e023f3a497", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "MSTR",  name: "Strategy",       tier: "stock", address: "0x266e5923f6118f8b340ca5a23ae7f71897361476", pool: "0x0e1f84a9e388071e20df101b36c14c817bf81953", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "HOOD",  name: "Robinhood",      tier: "stock", address: "0x953707d7a1cb30cc5c636bda8eaebe410341eb14", pool: "0x4e23bb828e51cbc03c81d76c844228cc75f6a287", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "CRCL",  name: "Circle",         tier: "stock", address: "0xa90872aca656ebe47bdebf3b19ec9dd9c5adc7f8", pool: "0x43cf441f5949d52faa105060239543492193c87e", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "SPY",   name: "S&P 500 ETF",    tier: "stock", address: "0xc88fcd8b874fdb3256e8b55b3decb8c24eab4c02", pool: "0x373f7a2b95f28f38500eb70652e12038cca3bab8", feeTier: 3000, decimals: 18, via: "fluxion" },
  { symbol: "QQQ",   name: "Nasdaq 100 ETF", tier: "stock", address: "0xdbd9232fee15351068fe02f0683146e16d9f2cea", pool: "0x505258001e834251634029742fc73b5cab4fd67d", feeTier: 3000, decimals: 18, via: "fluxion" },
];

export const SAFE: Asset[] = [
  { symbol: "sUSDe", name: "Staked Ethena USD (real yield)", tier: "safe", address: "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2", decimals: 18, via: "agni" },
  // Ondo USDY — tokenized US Treasuries, REAL on Mantle (verified on-chain 2026-06-03:
  // 0x5bE2…c5A6, "Ondo U.S. Dollar Yield", 18 dec). Listed for visibility but NOT
  // buyable in-app: acquisition is Ondo's KYC mint/redeem attestation flow and the only
  // USDC<>USDY DEX pools are dust (~$1k TVL, ~$0 vol; a 25 USDC swap returns ~7 USDY), so
  // there is no permissionless route. Flagged `coming` in displayAssets and excluded from
  // the AI universe (see api/allocate). To enable: add a validated ASSET_ROUTES entry once
  // a liquid USDC route exists, then drop the `coming` flag.
  { symbol: "USDY",  name: "Ondo US Dollar Yield",            tier: "safe", address: "0x5bE26527e817998A7206475496fDE1E68957c5A6", decimals: 18, via: "route" },
  // mUSD — the $1-pegged rebasing wrapper of USDY (verified on-chain 2026-06-03:
  // 0xab57…7cF3, "Mantle USD", 18 dec). Same gate as USDY: acquired by wrapping USDY
  // (KYC), and there are ZERO USDC<>mUSD DEX pools, so it's listed-only (`coming`).
  { symbol: "mUSD",  name: "Mantle USD (Ondo)",               tier: "safe", address: "0xab575258d37EaA5C8956EfABe71F4eE8F6397cF3", decimals: 18, via: "route" },
];

export const CRYPTO: Asset[] = [
  { symbol: "mETH", name: "Mantle Staked ETH", tier: "crypto", address: "0xcDA86A272531e8640cD7F1a92c01839911B90bb0", decimals: 18, via: "agni" },
  { symbol: "FBTC", name: "Bitcoin (Function)", tier: "crypto", address: "0xC96dE26018A54D51c097160568752c4E3BD6C364", decimals: 8,  via: "merchant_moe" },
];

export const ALL_ASSETS: Asset[] = [...STOCKS, ...SAFE, ...CRYPTO];

/** One hop of an Agni V3 route, with the pool we read for spot pricing. */
export interface RouteHop {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number; // V3 fee tier (uint24)
  pool: `0x${string}`; // V3 pool address (slot0 read for spot quote)
  tokenInDecimals: number;
  tokenOutDecimals: number;
}

/** A validated multi-hop swap route (USDC -> ... -> final asset) on a single router. */
export interface AssetRoute {
  router: `0x${string}`;
  kind: "agni_v3"; // exactInput(encodePacked path)
  hops: RouteHop[]; // ordered USDC-in -> final-out
}

const USDC_ADDR = USDC.address as `0x${string}`;
const SUSDE = "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2" as const;
const METH = "0xcDA86A272531e8640cD7F1a92c01839911B90bb0" as const;
const USDT = "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE" as const;

/**
 * VERIFIED swap routes (Mantle MCP getSwapQuote + getV3PoolState + Agni ABI from
 * Etherscan V2, 2026-06-01) for the SAFE/CRYPTO tiers. Each is a SINGLE Agni
 * `exactInput` call delivering the final token to the recipient (the executor for
 * AI invests, the user for manual buys), so the executor's balance-delta forward
 * stays correct. FBTC is intentionally absent — no clean single-router USDC route.
 */
export const ASSET_ROUTES: Record<string, AssetRoute> = {
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

/** True if `symbol` has a validated, executor-routable swap route (any tier). */
export function isRoutable(symbol: string): boolean {
  if (STOCKS.some((s) => s.symbol === symbol)) return true;
  return Boolean(ASSET_ROUTES[symbol]);
}

/**
 * Reverse a validated buy route (USDC -> ... -> asset) into its sell direction
 * (asset -> ... -> USDC). Same pools and fee tiers, hops walked backwards —
 * V3 pools are symmetric, so the reversed path is equally valid for exactInput.
 */
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
