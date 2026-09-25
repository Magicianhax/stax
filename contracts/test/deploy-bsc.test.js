const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const hre = require("hardhat");
const { BINANCE_ROUTER, WHITELIST_ASSETS } = require("../scripts/bsc-addresses");
const { main: deployBsc } = require("../scripts/deploy-bsc");
const { main: enableAssetsBsc } = require("../scripts/enable-assets-bsc");

// Proves the fix end to end: BSC_ASSETS_JSON, not a positional CLI arg, is what a curated
// (non-seed) asset list travels through, on the same in-memory network the reviewer used to
// reproduce HH305/HH308. Mirrors the mainnet command from the task report:
//   BSC_ASSETS_JSON=<file> npx hardhat run scripts/deploy-bsc.js --network bsc
//
//   npx hardhat test test/deploy-bsc.test.js

function tempAssetsFile(contents) {
  const file = path.join(os.tmpdir(), `bsc-assets-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(contents));
  return file;
}

describe("deploy-bsc.js + enable-assets-bsc.js on the in-memory hardhat network", () => {
  const ENV_KEYS = [
    "AGENT_SIGNER_ADDRESS",
    "BSC_ASSETS_JSON",
    "INFERENCE_VERIFIER_BSC",
    "IDENTITY_REGISTRY_BSC",
    "STAX_EXECUTOR_BSC",
    "STAX_EXECUTOR_BLOCK_BSC",
    "EXTRA_ASSETS",
  ];
  const savedEnv = {};
  before(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("whitelists a curated, non-seed asset instead of the hardcoded seed list", async () => {
    const [, signer] = await hre.viem.getWalletClients();
    const curated = await hre.viem.deployContract("MockERC20", ["Curated Stock", "CURB", 18]);

    process.env.AGENT_SIGNER_ADDRESS = signer.account.address;
    process.env.BSC_ASSETS_JSON = tempAssetsFile([{ symbol: "CURB", address: curated.address }]);
    delete process.env.INFERENCE_VERIFIER_BSC;
    delete process.env.IDENTITY_REGISTRY_BSC;
    delete process.env.STAX_EXECUTOR_BSC;

    const summary = await deployBsc();
    const executor = await hre.viem.getContractAt("StaxExecutor", summary.NEXT_PUBLIC_STAX_EXECUTOR_BSC);

    assert.equal(await executor.read.assetAllowed([curated.address]), true);
    assert.equal(await executor.read.routerAllowed([BINANCE_ROUTER]), true);
    // The seed list must not have snuck in — that was the bug: argv never reached loadAssets(),
    // so every run silently fell back to the six-token seed list regardless of what was asked for.
    assert.equal(await executor.read.assetAllowed([WHITELIST_ASSETS[0].address]), false);
  });

  it("enable-assets-bsc.js also reads BSC_ASSETS_JSON, so re-running a curated catalog works the same way", async () => {
    const [, signer] = await hre.viem.getWalletClients();

    process.env.AGENT_SIGNER_ADDRESS = signer.account.address;
    delete process.env.BSC_ASSETS_JSON; // deploy with the seed list first, as a real first deploy would
    delete process.env.INFERENCE_VERIFIER_BSC;
    delete process.env.IDENTITY_REGISTRY_BSC;
    delete process.env.STAX_EXECUTOR_BSC;
    const summary = await deployBsc();

    const laterTicker = await hre.viem.deployContract("MockERC20", ["Added Later", "LATEB", 18]);
    process.env.STAX_EXECUTOR_BSC = summary.NEXT_PUBLIC_STAX_EXECUTOR_BSC;
    process.env.BSC_ASSETS_JSON = tempAssetsFile([{ symbol: "LATEB", address: laterTicker.address }]);

    await enableAssetsBsc();

    const executor = await hre.viem.getContractAt("StaxExecutor", summary.NEXT_PUBLIC_STAX_EXECUTOR_BSC);
    assert.equal(await executor.read.assetAllowed([laterTicker.address]), true);
  });
});
