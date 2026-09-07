const hre = require("hardhat");

// Deploys TimelockGift (the "gift a basket" park-and-claim contract) to Base or Base Sepolia
// and points it at the Stax attestation key.
//
//   npm run deploy:gift-base           # needs PRIVATE_KEY (a little ETH on Base) + GIFT_SIGNER_ADDRESS
//   npm run deploy:gift-base-sepolia
//
// GIFT_SIGNER_ADDRESS is the address of GIFT_SIGNER_PRIVATE_KEY, the server-only key the web
// app signs claim authorisations with (web/.env.local). Get it from the private key with:
//   node -e "console.log(require('viem/accounts').privateKeyToAccount(process.env.GIFT_SIGNER_PRIVATE_KEY).address)"
//
// Resumable, like deploy-base.js: set STAX_GIFT_BASE in contracts/.env to reuse a contract a
// previous run already deployed, and every tx waits for its receipt before the next is sent.

async function main() {
  const giftSigner = process.env.GIFT_SIGNER_ADDRESS;
  if (!giftSigner) throw new Error("GIFT_SIGNER_ADDRESS not set in .env");
  if (!/^0x[0-9a-fA-F]{40}$/.test(giftSigner)) throw new Error(`GIFT_SIGNER_ADDRESS is not an address: ${giftSigner}`);

  const publicClient = await hre.viem.getPublicClient();
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) throw new Error("PRIVATE_KEY not set in .env (no deployer account)");
  const me = deployer.account.address;
  const chainId = await publicClient.getChainId();
  const balance = await publicClient.getBalance({ address: me });

  console.log(`Network: ${hre.network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${me}  (${Number(balance) / 1e18} ETH)`);
  console.log(`Gift signer: ${giftSigner}\n`);
  if (balance === 0n) throw new Error("Deployer has no ETH on this network");

  const wait = async (hash, label) => {
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
    console.log(`  ${label} -> ${hash}`);
    return r;
  };

  // Public RPCs are load-balanced; a gas estimate taken on a node that has not seen a fresh
  // contract yet returns ~25k and the tx runs out of gas. Wait until the RPC we talk to serves
  // the code before sending anything to a new contract.
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

  const reuse = (k) => (process.env[k] && /^0x[0-9a-fA-F]{40}$/.test(process.env[k]) ? process.env[k] : null);
  const suffix = hre.network.name === "baseSepolia" ? "_BASE_SEPOLIA" : "_BASE";

  // TimelockGift. The constructor already sets the signer; setSigner below is the resume path
  // (and a no-op read-back on a fresh deploy).
  let giftAddress, giftBlock;
  if (reuse(`STAX_GIFT${suffix}`) || reuse("STAX_GIFT_BASE")) {
    giftAddress = reuse(`STAX_GIFT${suffix}`) || reuse("STAX_GIFT_BASE");
    giftBlock = BigInt(process.env[`STAX_GIFT_BLOCK${suffix}`] || "0");
    console.log(`TimelockGift: ${giftAddress}  (reused, block ${giftBlock})`);
  } else {
    const { abi, bytecode } = await hre.artifacts.readArtifact("TimelockGift");
    const tx = await deployer.deployContract({ abi, bytecode, args: [giftSigner] });
    const receipt = await wait(tx, "deploy(TimelockGift)");
    giftAddress = receipt.contractAddress;
    giftBlock = receipt.blockNumber;
    console.log(`TimelockGift: ${giftAddress}  (block ${giftBlock})`);
  }
  await ensureCode(giftAddress, "TimelockGift");
  const gift = await hre.viem.getContractAt("TimelockGift", giftAddress);

  const current = await gift.read.signer();
  if (current.toLowerCase() === giftSigner.toLowerCase()) {
    console.log(`  setSigner already set`);
  } else {
    await writeSafe(() => gift.write.setSigner([giftSigner]), `setSigner(${giftSigner})`);
  }

  // Read-back confirmation: a wrong signer means nobody can ever claim.
  const confirmed = await gift.read.signer();
  if (confirmed.toLowerCase() !== giftSigner.toLowerCase()) {
    throw new Error(`signer is ${confirmed}, expected ${giftSigner}`);
  }
  const owner = await gift.read.owner();
  console.log(`  signer ${confirmed}\n  owner  ${owner}\n`);

  const summary = {
    network: hre.network.name,
    chainId,
    deployer: me,
    giftSigner,
    [`NEXT_PUBLIC_STAX_GIFT${suffix}`]: giftAddress,
    [`NEXT_PUBLIC_STAX_GIFT_BLOCK${suffix}`]: giftBlock.toString(),
  };
  console.log("=== Deployment summary ===");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\n=== Paste into web/.env.local ===");
  console.log(`NEXT_PUBLIC_STAX_GIFT${suffix}=${giftAddress}`);
  console.log(`# already set, kept next to it: GIFT_SIGNER_PRIVATE_KEY=0x…  (address ${giftSigner})`);
  console.log(`\n# contracts/.env (so a re-run resumes instead of redeploying)\nSTAX_GIFT${suffix}=${giftAddress}`);

  if (process.env.ETHERSCAN_API_KEY) {
    console.log(`\n=== Verifying on Basescan (Etherscan V2 key) ===`);
    try {
      await hre.run("verify:verify", { address: giftAddress, constructorArguments: [giftSigner] });
    } catch (e) {
      // Already-verified and rate-limit answers are not deploy failures.
      console.log(`  verify skipped: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    console.log(`\n=== Verify on Basescan (set ETHERSCAN_API_KEY to do it automatically) ===`);
    console.log(`npx hardhat verify --network ${hre.network.name} ${giftAddress} ${giftSigner}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
