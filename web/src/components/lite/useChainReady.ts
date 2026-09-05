"use client";

// Is investing switched on for the active network? Base's executor/verifier are
// deployed by `contracts/scripts/deploy-base.js`; until then `chain.contracts.deployed`
// is false and the invest / autopilot / record surfaces show a calm "being switched
// on" state instead of firing calls. The demo (landing phones, /demo) never hits a
// contract, so it always counts as ready. Manual Pro buy/sell doesn't need the
// executor and stays enabled regardless.
import { useChain } from "@/lib/chains/active";
import { useDemo } from "@/components/demo/DemoProvider";

export function useChainReady() {
  const chain = useChain();
  const demo = useDemo();
  return { chain, ready: chain.contracts.deployed || demo !== null };
}
