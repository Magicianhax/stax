// StaxExecutor, InferenceVerifier and IdentityRegistry on BSC mainnet, deployed 2026-09-24 by
// contracts/scripts/deploy-bsc.js (block 123802297) and verified on BscScan. Vera is agent 1 in
// the registry; the executor whitelists the Binance aggregator router and all 83 bStock/Ondo
// tokens in the curated list.
//
// `deployed` stays false for now on purpose: it switches Vera's invests and Autopilot from the
// direct smart-account path (tested) to the executor path, which has not yet run on BSC. Flip it
// after one small executor invest confirms the output lands in the user's account.
import type { StaxContracts } from "./types";

export const BSC_CONTRACTS: StaxContracts = {
  executor: "0xc8b10b6be1ce78df53d2e3159d83dca113e4b133",
  verifier: "0xc1efb92d4cdf6e2249038c7186ebc12cf42ef4d8",
  registry: "0xb94a10cf369a0e83f102a6facd318497a338b77c",
  agentId: BigInt(1),
  executorBlock: BigInt(123802297),
  deployed: false,
};
