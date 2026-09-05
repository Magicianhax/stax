const hre = require("hardhat");
const { ROUTERS, WHITELIST_ASSETS } = require("./base-addresses");

// (Re)whitelist the Base venues + assets on an already-deployed StaxExecutor, e.g. when a
// "coming soon" Coinbase stock gets its USDC pool, or a new token is added to base.ts.
//
//   STAX_EXECUTOR_BASE=0x...            executor address (required)
//   EXTRA_ASSETS=0xabc...,0xdef...      extra token addresses to whitelist (optional)
//   npm run enable:base
//
// Idempotent: routers/tokens already allowed are skipped (owner = PRIVATE_KEY in .env).

async function main() {
  const executorAddr = process.env.STAX_EXECUTOR_BASE;
  if (!executorAddr) throw new Error("STAX_EXECUTOR_BASE not set in .env");
  const extra = (process.env.EXTRA_ASSETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const a of extra) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`EXTRA_ASSETS: bad address ${a}`);
  }

  const publicClient = await hre.viem.getPublicClient();
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) throw new Error("PRIVATE_KEY not set in .env (no signer)");
  const me = deployer.account.address;
  console.log(`Network: ${hre.network.name}`);
  console.log(`Deployer (owner): ${me}`);
  console.log(`StaxExecutor: ${executorAddr}\n`);

  const executor = await hre.viem.getContractAt("StaxExecutor", executorAddr);
  const owner = await executor.read.owner();
  if (owner.toLowerCase() !== me.toLowerCase()) {
    throw new Error(`Signer ${me} is not the executor owner (${owner}). Aborting.`);
  }

  const txHashes = {};

  // 1) Routers (skip the ones already enabled).
  for (const r of ROUTERS) {
    if (await executor.read.routerAllowed([r.address])) {
      console.log(`router already allowed: ${r.name}`);
      continue;
    }
    const h = await executor.write.setRouter([r.address, true]);
    await publicClient.waitForTransactionReceipt({ hash: h });
    txHashes[`setRouter_${r.name}`] = h;
    console.log(`setRouter(${r.name} ${r.address}, true) -> ${h}`);
  }

  // 2) Assets: everything in base-addresses.js + EXTRA_ASSETS, minus what is already allowed.
  const wanted = [
    ...WHITELIST_ASSETS.map((a) => ({ symbol: a.symbol, address: a.address })),
    ...extra.map((address) => ({ symbol: `extra:${address}`, address })),
  ];
  const missing = [];
  for (const a of wanted) {
    if (await executor.read.assetAllowed([a.address])) console.log(`asset already allowed: ${a.symbol}`);
    else missing.push(a);
  }
  if (missing.length) {
    const h = await executor.write.setAssets([missing.map((a) => a.address), true]);
    await publicClient.waitForTransactionReceipt({ hash: h });
    txHashes.setAssets = h;
    console.log(`setAssets([${missing.map((a) => a.symbol).join(", ")}], true) -> ${h}`);
  } else {
    console.log("all assets already allowed, nothing to do");
  }

  // 3) Read-back confirmation.
  const checks = {};
  for (const r of ROUTERS) checks[`routerAllowed_${r.name}`] = await executor.read.routerAllowed([r.address]);
  for (const a of wanted) checks[`assetAllowed_${a.symbol}`] = await executor.read.assetAllowed([a.address]);
  const bad = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (bad.length) throw new Error(`read-back failed: ${bad.join(", ")}`);

  console.log("\n=== Enablement complete ===");
  console.log(JSON.stringify({ txHashes, checks }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
