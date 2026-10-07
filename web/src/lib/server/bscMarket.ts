import "server-only";

// The two BSC market reads a stock leg needs before it is built: the RWA catalog (which issuer
// is best right now) and Binance's cached RWA token list (the buyable gate). /api/invest-plan
// already reads both for the direct path and passes them in; Autopilot's runs don't, so
// lib/legBuilder.ts loads them here on demand. Both reads are cached (rwaCatalog, binance).
import type { RwaTickerView } from "@/lib/rwa";
import { getBinanceWeb3 } from "./binance";
import type { RwaToken } from "./binance/types";
import { bscCatalogSnapshot } from "./rwaCatalog";

export interface BscMarket {
  catalog: RwaTickerView[];
  tokens: RwaToken[];
  /** The clock the buyable gate and closed messages are read against. */
  nowMs: number;
}

export async function loadBscMarket(nowMs: number): Promise<BscMarket> {
  const [catalog, tokens] = await Promise.all([bscCatalogSnapshot(nowMs), getBinanceWeb3().rwaTokens()]);
  return { catalog: catalog.tickers, tokens, nowMs };
}
