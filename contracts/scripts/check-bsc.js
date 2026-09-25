// Read-only pre-flight for the BSC deployment. No private key, no Hardhat network needed:
//
//   npm run check:bsc                        (BSC_RPC_URL from .env, else public RPCs)
//   BSC_ASSETS_JSON=assets.json npm run check:bsc   (pre-flight a curated catalog instead)
//
// Asserts, against BSC mainnet:
//   - USDT has code and 18 decimals
//   - the Binance aggregator router has code
//   - every whitelisted stock token has code and the expected decimals()
// There are no venue pools to check here (unlike Base's Uniswap V3 pairs): BSC buys route
// entirely through the Binance Web3 aggregator, which owns its own liquidity sourcing.
// Checks whatever loadAssets() resolves to (the curated catalog when BSC_ASSETS_JSON is set,
// else the seed list) so a curated list gets the same code/decimals pre-flight the seed list
// always got — it used to only ever check the seed list, since the seed list was the only
// list deploy-bsc.js could reach either.
// Exits non-zero on the first failing assertion group.

require("dotenv").config();
const { createPublicClient, http, parseAbi, getAddress } = require("viem");
const { bsc } = require("viem/chains");
const A = require("./bsc-addresses");

const RPCS = [
  process.env.BSC_RPC_URL,
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed1.binance.org",
].filter(Boolean);

const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);

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

/** Scheme + host only: a keyed RPC URL carries its key in the path or query. */
function maskRpc(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.length > 1 || u.search ? "/…" : ""}`;
  } catch {
    return "<rpc>";
  }
}

async function main() {
  // Pick the first RPC that answers with chainId 56.
  let pc, rpc;
  for (const url of RPCS) {
    const c = createPublicClient({ chain: bsc, transport: http(url, { retryCount: 0, timeout: 15_000 }) });
    try {
      const id = await c.getChainId();
      if (id !== 56) throw new Error(`chainId ${id}`);
      pc = c;
      rpc = url;
      break;
    } catch (e) {
      console.log(`rpc ${maskRpc(url)} unusable (${e.shortMessage || e.message}); trying next`);
    }
  }
  if (!pc) throw new Error("no usable BSC RPC");
  const head = await withRetry(() => pc.getBlockNumber(), "blockNumber");
  console.log(`BSC mainnet via ${maskRpc(rpc)}  (block ${head})\n`);

  const read = (address, abi, functionName, args = []) =>
    withRetry(() => pc.readContract({ address, abi, functionName, args }), `${functionName}@${address.slice(0, 10)}`);
  const hasCode = async (address) => {
    const code = await withRetry(() => pc.getCode({ address }), `code@${address.slice(0, 10)}`);
    return !!code && code !== "0x";
  };

  const assets = A.loadAssets();

  // 0) Checksums: catch a mistyped address before it ends up in a whitelist tx.
  console.log("Addresses");
  assert(getAddress(A.USDT) === A.USDT, `USDT is checksummed (${A.USDT})`);
  assert(getAddress(A.BINANCE_ROUTER) === A.BINANCE_ROUTER, `BINANCE_ROUTER is checksummed (${A.BINANCE_ROUTER})`);
  for (const t of assets) assert(getAddress(t.address) === t.address, `${t.symbol} is checksummed (${t.address})`);

  // 1) USDT itself.
  console.log("\nUSDT");
  assert(await hasCode(A.USDT), `USDT has code`);
  assert((await read(A.USDT, ERC20_ABI, "decimals")) === 18, `USDT decimals == 18`);

  // 2) The Binance aggregator router.
  console.log("\nRouter");
  assert(await hasCode(A.BINANCE_ROUTER), `Binance Web3 aggregator router has code`);

  // 3) Whitelisted tokens: code + decimals (+ symbol for the log).
  console.log("\nWhitelisted assets");
  for (const t of assets) {
    const code = await hasCode(t.address);
    assert(code, `${t.symbol} ${t.address} has code`);
    if (!code) continue;
    const dec = await read(t.address, ERC20_ABI, "decimals");
    const sym = await read(t.address, ERC20_ABI, "symbol").catch(() => "?");
    assert(dec === t.decimals, `${t.symbol} decimals == ${t.decimals} (got ${dec}, on-chain symbol ${sym})`);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
