// StaxExecutor + InferenceVerifier are not deployed on BSC yet (ADR-0005). Until the human
// runs the deploy, `deployed` stays false and buys go through direct smart-account swaps.
// The deploy scripts write the real addresses here afterwards.
import { zeroAddress } from "viem";
import type { StaxContracts } from "./types";

export const BSC_CONTRACTS: StaxContracts = {
  executor: zeroAddress,
  verifier: zeroAddress,
  registry: zeroAddress,
  agentId: BigInt(0),
  executorBlock: BigInt(0),
  deployed: false,
};
