const hre = require("hardhat");
const { USDC, ROUTERS, WHITELIST_ASSETS } = require("./base-addresses");

// Deploys InferenceVerifier + IdentityRegistry + StaxExecutor to Base (or Base Sepolia),
// whitelists the Base venues (Uniswap V3 SwapRouter02, Aave v3 Pool) and every Base asset,
// and registers Vera in the IdentityRegistry.
//
//   npm run check:base     # read-only pre-flight, no key needed
//   npm run deploy:base    # needs PRIVATE_KEY (a little ETH on Base) + AGENT_SIGNER_ADDRESS
//
// Every tx waits for its receipt before the next one is sent.

const AGENT_CARD = process.env.AGENT_CARD_URI || "https://stax.best/.well-known/agent-card.json";

async function main() {
  const agentSigner = process.env.AGENT_SIGNER_ADDRESS;
  if (!agentSigner) throw new Error("AGENT_SIGNER_ADDRESS not set in .env");

  const publicClient = await hre.viem.getPublicClient();
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) throw new Error("PRIVATE_KEY not set in .env (no deployer account)");
  const me = deployer.account.address;
  const chainId = await publicClient.getChainId();
  const balance = await publicClient.getBalance({ address: me });

  console.log(`Network: ${hre.network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${me}  (${Number(balance) / 1e18} ETH)`);
  console.log(`Agent signer: ${agentSigner}`);
  console.log(`Agent card: ${AGENT_CARD}\n`);
  if (balance === 0n) throw new Error("Deployer has no ETH on this network");

  const wait = async (hash, label) => {
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
    console.log(`  ${label} -> ${hash}`);
    return r;
  };

  // Public RPCs are load-balanced; a gas estimate taken on a node that has not seen a
  // fresh contract yet returns ~25k and the tx runs out of gas. Wait until the RPC we
  // talk to serves the code before sending anything to a new contract.
  const ensureCode = async (address, label) => {
    for (let i = 0; i < 30; i++) {
      const code = await publicClient.getBytecode({ address }).catch(() => undefined);
      if (code && code !== "0x") return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`${label} has no code at ${address} after 60s`);
  };
  // A write that re-estimates and retries once if the receipt reverted (the same race).
  const writeSafe = async (fn, label) => {
    try {
      return await wait(await fn(), label);
    } catch (e) {
      if (!String(e.message).includes("reverted")) throw e;
      console.log(`  ${label} reverted once, retrying after a fresh estimate…`);
      await new Promise((r) => setTimeout(r, 4000));
      return wait(await fn(), label);
    }
  };

  // Resume support: set INFERENCE_VERIFIER_BASE / IDENTITY_REGISTRY_BASE / STAX_EXECUTOR_BASE in
  // .env to reuse contracts a previous run already deployed (their creation txs are not repeated).
  const reuse = (k) => (process.env[k] && /^0x[0-9a-fA-F]{40}$/.test(process.env[k]) ? process.env[k] : null);

  // 1) InferenceVerifier — the EIP-712 risk-inference gate.
  let verifier;
  if (reuse("INFERENCE_VERIFIER_BASE")) {
    verifier = await hre.viem.getContractAt("InferenceVerifier", reuse("INFERENCE_VERIFIER_BASE"));
    console.log(`InferenceVerifier: ${verifier.address}  (reused)`);
  } else {
    verifier = await hre.viem.deployContract("InferenceVerifier", [agentSigner]);
    console.log(`InferenceVerifier: ${verifier.address}`);
  }
  await ensureCode(verifier.address, "InferenceVerifier");

  // 2) IdentityRegistry — ERC-8004-style agent identity; register Vera (once).
  let registry;
  if (reuse("IDENTITY_REGISTRY_BASE")) {
    registry = await hre.viem.getContractAt("IdentityRegistry", reuse("IDENTITY_REGISTRY_BASE"));
    console.log(`IdentityRegistry:  ${registry.address}  (reused)`);
  } else {
    registry = await hre.viem.deployContract("IdentityRegistry", []);
    console.log(`IdentityRegistry:  ${registry.address}`);
  }
  await ensureCode(registry.address, "IdentityRegistry");
  let agentId;
  if ((await registry.read.nextAgentId()) > 1n) {
    agentId = (await registry.read.nextAgentId()) - 1n;
    console.log(`  Vera already registered -> agentId ${agentId}`);
  } else {
    const before = await registry.read.nextAgentId();
    await writeSafe(() => registry.write.register([me, AGENT_CARD]), "register(Vera)");
    // Poll until the RPC reflects the mint (load-balanced nodes can lag a block or two).
    let next = before;
    for (let i = 0; i < 20 && next === before; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      next = await registry.read.nextAgentId();
    }
    agentId = next - 1n;
    console.log(`  Vera registered -> agentId ${agentId}`);
  }

  // 3) StaxExecutor — commit + verify + non-custodial execution. Send the creation tx ourselves
  //    (instead of hre.viem.deployContract) so we hold the receipt and can report the deploy block.
  let executorAddress, executorBlock;
  if (reuse("STAX_EXECUTOR_BASE")) {
    executorAddress = reuse("STAX_EXECUTOR_BASE");
    executorBlock = BigInt(process.env.STAX_EXECUTOR_BLOCK_BASE || "0");
    console.log(`StaxExecutor:      ${executorAddress}  (reused, block ${executorBlock})`);
  } else {
    const { abi, bytecode } = await hre.artifacts.readArtifact("StaxExecutor");
    const executorTx = await deployer.deployContract({ abi, bytecode, args: [USDC, verifier.address] });
    const executorReceipt = await wait(executorTx, "deploy(StaxExecutor)");
    executorAddress = executorReceipt.contractAddress;
    executorBlock = executorReceipt.blockNumber;
    console.log(`StaxExecutor:      ${executorAddress}  (block ${executorBlock})`);
  }
  await ensureCode(executorAddress, "StaxExecutor");
  const executor = await hre.viem.getContractAt("StaxExecutor", executorAddress);

  // 4) Whitelist venues + assets (skips what is already set, so re-runs are cheap).
  for (const r of ROUTERS) {
    if (await executor.read.routerAllowed([r.address])) { console.log(`  setRouter(${r.name}) already set`); continue; }
    await writeSafe(() => executor.write.setRouter([r.address, true]), `setRouter(${r.name})`);
  }
  const assetAddrs = WHITELIST_ASSETS.map((a) => a.address);
  const missing = [];
  for (const a of assetAddrs) if (!(await executor.read.assetAllowed([a]))) missing.push(a);
  if (missing.length) await writeSafe(() => executor.write.setAssets([missing, true]), `setAssets(${missing.length} tokens)`);
  else console.log(`  setAssets already set`);

  // 5) Read-back confirmation.
  for (const r of ROUTERS) {
    if (!(await executor.read.routerAllowed([r.address]))) throw new Error(`router not allowed: ${r.name}`);
  }
  for (const a of WHITELIST_ASSETS) {
    if (!(await executor.read.assetAllowed([a.address]))) throw new Error(`asset not allowed: ${a.symbol}`);
  }
  console.log(
    `Whitelisted ${ROUTERS.length} routers + ${assetAddrs.length} assets: ${WHITELIST_ASSETS.map((a) => a.symbol).join(" ")}\n`,
  );

  const suffix = hre.network.name === "baseSepolia" ? "_BASE_SEPOLIA" : "_BASE";
  const summary = {
    network: hre.network.name,
    chainId,
    deployer: me,
    agentSigner,
    [`NEXT_PUBLIC_STAX_EXECUTOR${suffix}`]: executorAddress,
    [`NEXT_PUBLIC_INFERENCE_VERIFIER${suffix}`]: verifier.address,
    [`NEXT_PUBLIC_IDENTITY_REGISTRY${suffix}`]: registry.address,
    [`NEXT_PUBLIC_STAX_AGENT_ID${suffix}`]: agentId.toString(),
    [`NEXT_PUBLIC_STAX_EXECUTOR_BLOCK${suffix}`]: executorBlock.toString(),
  };
  console.log("=== Deployment summary ===");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\n=== Paste into web/.env.local ===");
  for (const k of Object.keys(summary)) if (k.startsWith("NEXT_PUBLIC_")) console.log(`${k}=${summary[k]}`);
  console.log(`\n# contracts/.env (for npm run enable:base)\nSTAX_EXECUTOR${suffix}=${executorAddress}`);

  console.log(`\n=== Verify on Basescan (Etherscan V2 key) ===`);
  console.log(`npx hardhat verify --network ${hre.network.name} ${verifier.address} ${agentSigner}`);
  console.log(`npx hardhat verify --network ${hre.network.name} ${registry.address}`);
  console.log(`npx hardhat verify --network ${hre.network.name} ${executorAddress} ${USDC} ${verifier.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
