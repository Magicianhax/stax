const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const A = require("../scripts/bsc-addresses");

// Task 10 review fix: deploy-bsc.js, check-bsc.js and enable-assets-bsc.js all whitelist or
// verify "the asset list", and that list has to come from somewhere other than argv — a
// `hardhat run` invocation never forwards a positional CLI argument to the script (HH305 with
// `--`, HH308 without it), so the seed list in this file was the only list any of the three
// scripts could ever reach. loadAssets() is the one place that decides the list; these pin it
// reading BSC_ASSETS_JSON instead.
//
//   npx hardhat test test/bsc-addresses.test.js

function tempAssetsFile(contents) {
  const file = path.join(os.tmpdir(), `bsc-assets-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return file;
}

describe("bsc-addresses loadAssets", () => {
  const prevEnv = process.env.BSC_ASSETS_JSON;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.BSC_ASSETS_JSON;
    else process.env.BSC_ASSETS_JSON = prevEnv;
  });

  it("falls back to the seed list when BSC_ASSETS_JSON is unset", () => {
    delete process.env.BSC_ASSETS_JSON;
    assert.deepEqual(A.loadAssets(), A.WHITELIST_ASSETS);
  });

  it("reads a curated list from BSC_ASSETS_JSON, defaulting decimals to 18", () => {
    const curated = [{ symbol: "CURB", address: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead" }];
    process.env.BSC_ASSETS_JSON = tempAssetsFile(curated);
    assert.deepEqual(A.loadAssets(), [
      { symbol: "CURB", address: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead", decimals: 18 },
    ]);
  });

  it("rejects an entry with a malformed address", () => {
    process.env.BSC_ASSETS_JSON = tempAssetsFile([{ symbol: "BAD", address: "not-an-address" }]);
    assert.throws(() => A.loadAssets(), /bad entry/);
  });

  it("rejects an empty array", () => {
    process.env.BSC_ASSETS_JSON = tempAssetsFile([]);
    assert.throws(() => A.loadAssets(), /non-empty JSON array/);
  });
});
