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

  // 1) InferenceVerifier — the EIP-712 risk-inference gate.
  const verifier = await hre.viem.deployContract("InferenceVerifier", [agentSigner]);
  console.log(`InferenceVerifier: ${verifier.address}`);

  // 2) IdentityRegistry — ERC-8004-style agent identity; register Vera.
  const registry = await hre.viem.deployContract("IdentityRegistry", []);
  console.log(`IdentityRegistry:  ${registry.address}`);
  await wait(await registry.write.register([me, AGENT_CARD]), "register(Vera)");
  const agentId = (await registry.read.nextAgentId()) - 1n;
  console.log(`  Vera registered -> agentId ${agentId}`);

  // 3) StaxExecutor — commit + verify + non-custodial execution. Send the creation tx ourselves
  //    (instead of hre.viem.deployContract) so we hold the receipt and can report the deploy block.
  const { abi, bytecode } = await hre.artifacts.readArtifact("StaxExecutor");
  const executorTx = await deployer.deployContract({ abi, bytecode, args: [USDC, verifier.address] });
  const executorReceipt = await wait(executorTx, "deploy(StaxExecutor)");
  const executorAddress = executorReceipt.contractAddress;
  const executorBlock = executorReceipt.blockNumber;
  const executor = await hre.viem.getContractAt("StaxExecutor", executorAddress);
  console.log(`StaxExecutor:      ${executorAddress}  (block ${executorBlock})`);

  // 4) Whitelist venues + assets.
  for (const r of ROUTERS) {
    await wait(await executor.write.setRouter([r.address, true]), `setRouter(${r.name})`);
  }
  const assetAddrs = WHITELIST_ASSETS.map((a) => a.address);
  await wait(await executor.write.setAssets([assetAddrs, true]), `setAssets(${assetAddrs.length} tokens)`);

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
