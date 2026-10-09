import "server-only";

// The one import every other task uses. A single lazily-built instance, not a class: nothing
// here holds per-call state, so a singleton is simpler than a client object to thread through
// the codebase.
import { balances } from "./wallet";
import { candles } from "./market";
import { rwaProfile, rwaPrices, rwaSearch, rwaTokens } from "./rwa";
import { simulate } from "./transaction";
import { buildSwap, quote, quoteAndSwap } from "./trading";
import type { BinanceWeb3 } from "./types";

let instance: BinanceWeb3 | undefined;

export function getBinanceWeb3(): BinanceWeb3 {
  if (!instance) {
    instance = { rwaTokens, rwaPrices, rwaSearch, rwaProfile, candles, quote, buildSwap, quoteAndSwap, simulate, balances };
  }
  return instance;
}
