// Read-only pre-flight for the Base deployment. No private key, no Hardhat network needed:
//
//   npm run check:base                       (BASE_RPC_URL from .env, else public RPCs)
//
// Asserts, against Base mainnet:
//   - every whitelisted token has code and the expected decimals()
//   - SwapRouter02.factory() is the Uniswap V3 factory
//   - Aave v3 Pool.getReserveData(USDC).aTokenAddress == aBasUSDC
//   - every stock/crypto pool in base-addresses.js pairs the token with USDC
// Exits non-zero on the first failing assertion group.

require("dotenv").config();
const { createPublicClient, http, parseAbi, getAddress } = require("viem");
const { base } = require("viem/chains");
const A = require("./base-addresses");

// mainnet.base.org rate-limits bursts of eth_call; publicnode is the roomier default fallback.
const RPCS = [
  process.env.BASE_RPC_URL,
  "https://base-rpc.publicnode.com",
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
].filter(Boolean);

const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
const ROUTER02_ABI = parseAbi(["function factory() view returns (address)", "function WETH9() view returns (address)"]);
const POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);
// Aave v3 Pool.getReserveData returns a struct; only aTokenAddress (index 8) matters here.
const AAVE_ABI = parseAbi([
  "struct ReserveConfigurationMap { uint256 data; }",
  "struct ReserveData { ReserveConfigurationMap configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }",
  "function getReserveData(address asset) view returns (ReserveData)",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry with exponential backoff, rotating RPCs on repeated failure (public RPCs rate-limit). */
async function withRetry(fn, label, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = 400 * 2 ** i;
      process.stdout.write(`  (retry ${i + 1}/${attempts} ${label}: ${String(e.shortMessage || e.message).slice(0, 80)}; ${wait}ms)\n`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

let failures = 0;
function assert(ok, msg) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`);
  if (!ok) failures++;
}
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();

async function main() {
  // Pick the first RPC that answers with chainId 8453.
  let pc, rpc;
  for (const url of RPCS) {
    const c = createPublicClient({ chain: base, transport: http(url, { retryCount: 0, timeout: 15_000 }) });
    try {
      const id = await c.getChainId();
      if (id !== 8453) throw new Error(`chainId ${id}`);
      pc = c;
      rpc = url;
      break;
    } catch (e) {
      console.log(`rpc ${url} unusable (${e.shortMessage || e.message}); trying next`);
    }
  }
  if (!pc) throw new Error("no usable Base RPC");
  const head = await withRetry(() => pc.getBlockNumber(), "blockNumber");
  console.log(`Base mainnet via ${rpc}  (block ${head})\n`);

  const read = (address, abi, functionName, args = []) =>
    withRetry(() => pc.readContract({ address, abi, functionName, args }), `${functionName}@${address.slice(0, 10)}`);
  const hasCode = async (address) => {
    const code = await withRetry(() => pc.getCode({ address }), `code@${address.slice(0, 10)}`);
    return !!code && code !== "0x";
  };

  // 0) Checksums: catch a mistyped address before it ends up in a whitelist tx.
  console.log("Addresses");
  for (const [k, v] of Object.entries(A)) {
    if (typeof v === "string") assert(getAddress(v) === v, `${k} is checksummed (${v})`);
  }

  // 1) USDC itself.
  console.log("\nUSDC");
  assert(await hasCode(A.USDC), `USDC has code`);
  assert((await read(A.USDC, ERC20_ABI, "decimals")) === 6, `USDC decimals == 6`);

  // 2) Whitelisted tokens: code + decimals (+ symbol for the log).
  console.log("\nWhitelisted assets");
  for (const t of A.WHITELIST_ASSETS) {
    const code = await hasCode(t.address);
    assert(code, `${t.symbol} ${t.address} has code`);
    if (!code) continue;
    const dec = await read(t.address, ERC20_ABI, "decimals");
    const sym = await read(t.address, ERC20_ABI, "symbol").catch(() => "?");
    assert(dec === t.decimals, `${t.symbol} decimals == ${t.decimals} (got ${dec}, on-chain symbol ${sym})`);
  }

  // 3) Venues.
  console.log("\nVenues");
  assert(await hasCode(A.UNISWAP_ROUTER02), `SwapRouter02 has code`);
  const factory = await read(A.UNISWAP_ROUTER02, ROUTER02_ABI, "factory");
  assert(eq(factory, A.UNISWAP_V3_FACTORY), `SwapRouter02.factory() == ${A.UNISWAP_V3_FACTORY} (got ${factory})`);
  const weth9 = await read(A.UNISWAP_ROUTER02, ROUTER02_ABI, "WETH9");
  assert(eq(weth9, A.WETH), `SwapRouter02.WETH9() == ${A.WETH} (got ${weth9})`);

  assert(await hasCode(A.AAVE_V3_POOL), `Aave v3 Pool has code`);
  const reserve = await read(A.AAVE_V3_POOL, AAVE_ABI, "getReserveData", [A.USDC]);
  assert(eq(reserve.aTokenAddress, A.A_BAS_USDC), `Aave getReserveData(USDC).aTokenAddress == ${A.A_BAS_USDC} (got ${reserve.aTokenAddress})`);

  // 4) Pools: each must pair the token with USDC at the expected fee tier.
  console.log("\nUniswap V3 pools");
  for (const t of [...A.STOCKS, ...A.CRYPTO]) {
    if (!t.pool) {
      console.log(`  skip  ${t.symbol}: no USDC pool yet`);
      continue;
    }
    const code = await hasCode(t.pool);
    assert(code, `${t.symbol} pool ${t.pool} has code`);
    if (!code) continue;
    // Sequential on purpose: public RPCs throttle parallel eth_call bursts.
    const t0 = await read(t.pool, POOL_ABI, "token0");
    const t1 = await read(t.pool, POOL_ABI, "token1");
    const fee = await read(t.pool, POOL_ABI, "fee");
    const pair = [t0, t1];
    const okPair = pair.some((x) => eq(x, t.address)) && pair.some((x) => eq(x, A.USDC));
    assert(okPair, `${t.symbol} pool pairs ${t.symbol}/USDC (token0 ${t0}, token1 ${t1})`);
    assert(fee === t.feeTier, `${t.symbol} pool fee == ${t.feeTier} (got ${fee})`);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
