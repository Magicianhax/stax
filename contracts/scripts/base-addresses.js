// Base mainnet (chainId 8453) addresses used by the deploy / enable / check scripts.
// Single source of truth for the app is web/src/lib/chains/base.ts — keep these in sync
// (every address below was copied from there; all verified on-chain 2026-09-05).

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Venues the executor may call.
const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const UNISWAP_ROUTER02 = "0x2626664c2603336E57B271c5C0b26F421741e481"; // SwapRouter02 (no deadline field)
const AAVE_V3_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
// KyberSwap MetaAggregationRouterV2 (aggregates Aerodrome, Aerodrome CL, Uniswap V3, ...). Code verified on Base 2026-09-06.
const KYBER_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";

// Output tokens.
const A_BAS_USDC = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"; // Aave v3 aToken for USDC (6 dec)
const WETH = "0x4200000000000000000000000000000000000006"; // 18 dec
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // 8 dec

// Coinbase tokenized stocks (B20, 8 dec). `pool` = deepest USDC Uniswap V3 pool; absent = no pool yet.
const STOCKS = [
  { symbol: "NVDAc",  address: "0xb20000000000000000000078ee7ce2fE4908108C", pool: "0x60661b315553EB81872deEA9a66d567Cf0CCd33B", feeTier: 3000 },
  { symbol: "GOOGLc", address: "0xb2000000000000000000002D0BA3164cc74f58B7", pool: "0x1f52F46BaC657564c31122b12b43A459E09273C8", feeTier: 10000 },
  { symbol: "AAPLc",  address: "0xb200000000000000000000C2e324d24d7eEcd1fb", pool: "0x97F35d1E92795327614BE000cd18cba1Be2c1931", feeTier: 3000 },
  { symbol: "METAc",  address: "0xb2000000000000000000008bC8786B856E61707C", pool: "0x583919ec1975a1238C50e1940911894ee6912476", feeTier: 3000 },
  { symbol: "SPCXc",  address: "0xb2000000000000000000007b9fcbd005511aCBd5", pool: "0x127a12FC0953ab2ab89558c67Ba6D597D7140431", feeTier: 10000 },
  // Minted, no USDC pool yet (2026-09-05). Whitelisting now saves a tx once they become liquid.
  { symbol: "TSLAc",  address: "0xb2000000000000000000001e800a7f5189430cD0" },
  { symbol: "AMZNc",  address: "0xb200000000000000000000d9192b6B456483C2E8" },
  { symbol: "MSFTc",  address: "0xB200000000000000000000Ab99cFa739E253872B" },
  { symbol: "MSTRc",  address: "0xb2000000000000000000004884b426556b92883d" },
  { symbol: "COINc",  address: "0xb200000000000000000000c85a31389D71F3ecfb" },
  { symbol: "CRCLc",  address: "0xB20000000000000000000019f6E7C675b73C2e4D" },
];

const CRYPTO = [
  { symbol: "cbBTC", address: CBBTC, decimals: 8, pool: "0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef", feeTier: 500 },
  { symbol: "WETH",  address: WETH,  decimals: 18, pool: "0xd0b53D9277642d899DF5C87A3966A349A798F224", feeTier: 500 },
];

const SAFE = [{ symbol: "aBasUSDC", address: A_BAS_USDC, decimals: 6 }];

/** Every token the executor whitelists, with the expected `decimals()` for the sanity check. */
const WHITELIST_ASSETS = [
  ...STOCKS.map((s) => ({ ...s, decimals: 8 })),
  ...CRYPTO,
  ...SAFE,
];

const ROUTERS = [
  { name: "KyberSwap MetaAggregationRouterV2", address: KYBER_ROUTER },
  { name: "Uniswap V3 SwapRouter02", address: UNISWAP_ROUTER02 },
  { name: "Aave v3 Pool", address: AAVE_V3_POOL },
];

module.exports = {
  USDC,
  UNISWAP_V3_FACTORY,
  UNISWAP_ROUTER02,
  AAVE_V3_POOL,
  KYBER_ROUTER,
  A_BAS_USDC,
  WETH,
  CBBTC,
  STOCKS,
  CRYPTO,
  SAFE,
  WHITELIST_ASSETS,
  ROUTERS,
};
