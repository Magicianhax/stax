// BSC mainnet (chainId 56) addresses used by the deploy / enable / check scripts.
// Single source of truth for the app is web/src/lib/chains/bsc.ts and bsc.assets.ts — keep
// these in sync. Addresses here are checksummed copies of what those files carry lowercase
// (bsc.assets.ts is Task 9's file; this script does not import it so contracts/ never depends
// on web/).

const fs = require("node:fs");

const USDT = "0x55d398326f99059fF775485246999027B3197955"; // BSC cash, 18 decimals

// The only venue the executor may call on BSC: the Binance Web3 DEX aggregator router, which
// is also the approval spender for every quote (docs/BINANCE-WEB3.md §4).
const BINANCE_ROUTER = "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5";

// Tokenized stocks seeded in web/src/lib/chains/bsc.assets.ts (18 dec, bStock/Ondo issued).
// Task 9 replaces that seed list with the curated catalog; re-run enable-assets-bsc.js after.
const STOCKS = [
  { symbol: "NVDAB", address: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436" },
  { symbol: "TSLAB", address: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f" },
  { symbol: "MSFTB", address: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0" },
  { symbol: "METAB", address: "0x7425889FE94F9d693E8daefE88BCCed6AcFEf4c0" },
  { symbol: "GOOGLB", address: "0x3F53De71c126BdaBAe20f9cD64848d317f6C3238" },
  { symbol: "AAPLon", address: "0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4" },
];

/** Every token the executor whitelists, with the expected `decimals()` for the sanity check. */
const WHITELIST_ASSETS = STOCKS.map((s) => ({ ...s, decimals: 18 }));

const ROUTERS = [{ name: "Binance Web3 aggregator", address: BINANCE_ROUTER }];

// The asset list deploy-bsc.js whitelists, check-bsc.js pre-flights and enable-assets-bsc.js
// (re)whitelists — all three need the same curated catalog once Task 9's replaces the seed
// list above, so the loading lives in one place.
//
// This reads an env var, not a CLI argument. `hardhat run <script> --network <net> -- <arg>`
// cannot forward that trailing argument to the script: Hardhat 2's CLI parses everything after
// the script path itself, and rejects it before the script ever runs (HH305 with the `--`
// separator, HH308 without it). BSC_ASSETS_JSON works the same way AGENT_SIGNER_ADDRESS and
// the *_BSC resume addresses already do below.
//
//   BSC_ASSETS_JSON=/path/to/assets.json npx hardhat run scripts/deploy-bsc.js --network bsc
function loadAssets() {
  const jsonPath = process.env.BSC_ASSETS_JSON;
  if (!jsonPath) return WHITELIST_ASSETS;
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${jsonPath}: expected a non-empty JSON array`);
  for (const a of raw) {
    if (!a.symbol || !/^0x[0-9a-fA-F]{40}$/.test(a.address)) {
      throw new Error(`${jsonPath}: bad entry ${JSON.stringify(a)}`);
    }
  }
  return raw.map((a) => ({ decimals: 18, ...a }));
}

module.exports = {
  USDT,
  BINANCE_ROUTER,
  STOCKS,
  WHITELIST_ASSETS,
  ROUTERS,
  loadAssets,
};
