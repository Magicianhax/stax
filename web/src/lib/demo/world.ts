// Picks the demo world for a network. BNB Chain is the demo people are meant to try (and the
// default network); Base stays reachable because gifts exist only there, so opening one from the
// demo has to land on a world that has them. Mantle is not offered in the demo and reads as Base.
import type { ChainKey } from "@/lib/chains/types";
import {
  DEMO_ACTIVITY,
  DEMO_ADDRESS,
  DEMO_MARKET_SUMMARY,
  DEMO_PORTFOLIO,
  DEMO_PRICES,
  DEMO_TRANSACTIONS,
  DEMO_USDC,
  DEMO_VERA_RECORD,
} from "@/lib/demo/demoData";
import { demoPortfolioHistory } from "@/lib/demo/demoHistory";
import { buildBscWorld } from "@/lib/demo/bscWorld";
import { DEMO_NOW } from "@/lib/demoSeries";
import type { DemoFill, DemoWorld } from "@/lib/demo/demoTypes";

/** The networks the demo can show, in the order its switch lists them. */
export const DEMO_CHAIN_KEYS: ChainKey[] = ["bsc", "base"];

let baseWorld: DemoWorld | null = null;

/** The original Base demo (Coinbase tokenized stocks, Safe Dollars), unchanged. */
export function baseDemoWorld(): DemoWorld {
  if (!baseWorld) {
    baseWorld = {
      chain: "base",
      address: DEMO_ADDRESS as `0x${string}`,
      usdc: DEMO_USDC,
      portfolio: DEMO_PORTFOLIO,
      activity: DEMO_ACTIVITY,
      transactions: DEMO_TRANSACTIONS,
      veraRecord: DEMO_VERA_RECORD,
      prices: DEMO_PRICES,
      marketSummary: DEMO_MARKET_SUMMARY,
      history: demoPortfolioHistory,
      rwa: null,
      spreadBoard: null,
      spreadHistory: () => null,
      earnings: null,
      savings: null,
      nowMs: DEMO_NOW,
    };
  }
  return baseWorld;
}

export function demoWorldFor(chain: ChainKey, opts: { nowMs: number; fills: readonly DemoFill[] }): DemoWorld {
  return chain === "bsc" ? buildBscWorld(opts) : baseDemoWorld();
}
