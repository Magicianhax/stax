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
  // BNB Chain's executor is live since 2026-10-07, so BSC (and the BNB Chain demo, which uses the
  // same chain) is ready through `deployed`. The `!demo.rwa` clause only matters for a Binance
  // chain with no executor: its demo mirrors an app that invests straight through the router.
  const ready = chain.contracts.deployed || (demo !== null && !demo.rwa);
  // Vera plans and basket buys. A Binance chain with no executor (ADR-0005) still invests through
  // the aggregator straight from the smart account, so it is investable without one. `ready`
  // stays executor-only for the surfaces that truly need it (autopilot, record).
  const investable = ready || Boolean(chain.routers.binance);
  return { chain, ready, investable };
}
