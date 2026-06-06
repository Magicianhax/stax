// swap-mnt-usdc.mjs — manual on-chain smoke test: native MNT -> USDC on Mantle.
//
// Safe by design: DRY-RUN by default (quotes + checks, no broadcast). It only
// sends transactions when you pass `--go`. Slippage is always enforced via an
// on-chain amountOutMinimum derived from a live pool quote.
//
// Usage (run it yourself — it moves real funds):
//   node scripts/swap-mnt-usdc.mjs            # dry run, 5 MNT
//   node scripts/swap-mnt-usdc.mjs 2.5        # dry run, 2.5 MNT
//   node scripts/swap-mnt-usdc.mjs 2.5 --go   # BROADCAST 2.5 MNT -> USDC
//
// Signs with AGENT_SIGNER_PRIVATE_KEY from .env.local (the wallet that must hold
// the MNT). Flow: wrap MNT->WMNT, approve WMNT to the Agni router, exactInputSingle.
import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, parseEther, formatEther,
  formatUnits, getContract,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ── Mantle mainnet constants ──────────────────────────────────────────────────
const RPC = "https://rpc.mantle.xyz";
const CHAIN_ID = 5000;
const WMNT = "0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8";
const USDC = "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9";
const AGNI_ROUTER = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421"; // from the live quote
const FEE_TIER = 100; // WMNT/USDC best pool (0.01%)
const SLIPPAGE_BPS = 100n; // 1% floor
const MAX_UINT = (1n << 256n) - 1n;

const mantle = {
  id: CHAIN_ID, name: "Mantle", nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const WMNT_ABI = [
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
];
const ERC20_BAL = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }];
// Agni SwapRouter (Uniswap V3 fork) — exactInputSingle with deadline in the struct.
const ROUTER_ABI = [{
  name: "exactInputSingle", type: "function", stateMutability: "payable",
  inputs: [{ type: "tuple", name: "params", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }],
}];
// V3 pool slot0 for a spot quote (we resolve the pool off the factory-known address from the MCP quote).
const POOL = "0x7b3A4b36b0C5c95142AFCD1b883ed055AA166f85"; // WMNT/USDC fee-100 pool (from live quote)
const POOL_ABI = [
  { name: "slot0", type: "function", stateMutability: "view", inputs: [], outputs: [
    { name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" },
    { name: "obi", type: "uint16" }, { name: "obc", type: "uint16" }, { name: "obcn", type: "uint16" },
    { name: "fp", type: "uint8" }, { name: "unlocked", type: "bool" }] },
  { name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const Q96 = 2n ** 96n;
const Q192 = Q96 * Q96;

function loadKey() {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const m = env.match(/^AGENT_SIGNER_PRIVATE_KEY=(.+)$/m);
  if (!m) throw new Error("AGENT_SIGNER_PRIVATE_KEY not found in .env.local");
  let pk = m[1].trim().replace(/^["']|["']$/g, "");
  return pk.startsWith("0x") ? pk : "0x" + pk;
}

async function main() {
  const args = process.argv.slice(2);
  const go = args.includes("--go");
  const amountMnt = args.find((a) => /^\d/.test(a)) ?? "5";
  const amountInWei = parseEther(amountMnt);

  const account = privateKeyToAccount(loadKey());
  const pub = createPublicClient({ chain: mantle, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: mantle, transport: http(RPC) });

  console.log(`\n  Stax MNT -> USDC swap  (${go ? "LIVE — will broadcast" : "DRY RUN"})`);
  console.log(`  signer:  ${account.address}`);
  console.log(`  amount:  ${amountMnt} MNT\n`);

  // 1) Balance check.
  const mnt = await pub.getBalance({ address: account.address });
  console.log(`  MNT balance: ${formatEther(mnt)}`);
  if (mnt < amountInWei) {
    console.error(`  ✗ Not enough MNT. Fund ${account.address} with at least ${amountMnt} MNT (+ a little for gas).`);
    process.exit(1);
  }

  // 2) Live spot quote from the pool -> slippage-guarded minOut.
  const pool = getContract({ address: POOL, abi: POOL_ABI, client: pub });
  const [slot0, token0] = await Promise.all([pool.read.slot0(), pool.read.token0()]);
  const sqrtP = slot0[0];
  const wmntIsToken0 = token0.toLowerCase() === WMNT.toLowerCase();
  // out(USDC raw) from in(WMNT raw): branch on token ordering.
  const priceX192 = sqrtP * sqrtP;
  const expectedOut = wmntIsToken0
    ? (amountInWei * priceX192) / Q192          // USDC = WMNT * price
    : (amountInWei * Q192) / priceX192;         // USDC = WMNT / price
  const minOut = (expectedOut * (10000n - SLIPPAGE_BPS)) / 10000n;
  console.log(`  spot expected: ~${formatUnits(expectedOut, 6)} USDC`);
  console.log(`  min out (1%):   ${formatUnits(minOut, 6)} USDC`);

  if (!go) {
    console.log(`\n  Dry run only. Re-run with --go to wrap, approve, and swap.\n`);
    return;
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const wmnt = getContract({ address: WMNT, abi: WMNT_ABI, client: { public: pub, wallet } });

  // 3) Wrap MNT -> WMNT.
  console.log(`\n  → wrapping ${amountMnt} MNT...`);
  let hash = await wmnt.write.deposit({ value: amountInWei });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`    wrapped: ${hash}`);

  // 4) Approve router (only if needed).
  const allowance = await wmnt.read.allowance([account.address, AGNI_ROUTER]);
  if (allowance < amountInWei) {
    console.log(`  → approving WMNT to Agni router...`);
    hash = await wmnt.write.approve([AGNI_ROUTER, MAX_UINT]);
    await pub.waitForTransactionReceipt({ hash });
    console.log(`    approved: ${hash}`);
  }

  // 5) Swap WMNT -> USDC.
  console.log(`  → swapping...`);
  const usdcBefore = await pub.readContract({ address: USDC, abi: ERC20_BAL, functionName: "balanceOf", args: [account.address] });
  hash = await wallet.writeContract({
    address: AGNI_ROUTER, abi: ROUTER_ABI, functionName: "exactInputSingle",
    args: [{ tokenIn: WMNT, tokenOut: USDC, fee: FEE_TIER, recipient: account.address, deadline, amountIn: amountInWei, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const usdcAfter = await pub.readContract({ address: USDC, abi: ERC20_BAL, functionName: "balanceOf", args: [account.address] });
  console.log(`    swap: ${hash}  (status: ${receipt.status})`);
  console.log(`\n  ✓ Received ${formatUnits(usdcAfter - usdcBefore, 6)} USDC.\n`);
}

main().catch((e) => { console.error("\n  ✗ " + (e.shortMessage || e.message) + "\n"); process.exit(1); });
