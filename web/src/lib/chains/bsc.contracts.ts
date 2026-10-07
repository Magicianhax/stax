// StaxExecutor, InferenceVerifier and IdentityRegistry on BSC mainnet, deployed 2026-09-24 by
// contracts/scripts/deploy-bsc.js (block 123802297) and verified on BscScan. Vera is agent 1 in
// the registry; the executor whitelists the Binance aggregator router, all 83 bStock/Ondo tokens
// in the curated list, and BTCB/ETH/WBNB.
//
// `deployed: true`: the executor path is live on BSC since the 2026-10-07 test, a $6 AAPL (Ondo)
// investWithAI that delivered 0.017887 AAPLon (min 0.017708) with nothing left in the executor,
// tx 0x4e403fb3a2871c0973a076e61410dff42eb90702b97e80bdde97254ceaf8bc3a. Vera's plans, baskets and
// Autopilot now go through it (signed risk check, on-chain record); manual Buy/Sell still goes
// straight from the account through /api/swap-quote. The direct smart-account path in
// /api/invest-plan stays as the fallback for a Binance chain with no executor.
import type { StaxContracts } from "./types";

export const BSC_CONTRACTS: StaxContracts = {
  executor: "0xc8b10b6be1ce78df53d2e3159d83dca113e4b133",
  verifier: "0xc1efb92d4cdf6e2249038c7186ebc12cf42ef4d8",
  registry: "0xb94a10cf369a0e83f102a6facd318497a338b77c",
  agentId: BigInt(1),
  executorBlock: BigInt(123802297),
  deployed: true,
};
