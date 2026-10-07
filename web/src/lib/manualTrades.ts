// Manual buys and sells, read from a wallet's token transfers grouped by transaction. Pure (no
// chain, no DB) so the cost-basis rules are plain tests; lib/server/positions.ts builds the
// groups and feeds them in.
import type { Trade } from "./positions";

/** One transaction's token movements for one account (the fee transfer to the treasury separated out). */
export interface TxGroup {
  hash: string;
  at: number;
  usdcOut: number;
  usdcIn: number;
  feeOut: number;
  assetIn: Map<string, number>;
  assetOut: Map<string, number>;
}

/**
 * Manual buys / sells from transfer groups not already explained by Vera fills.
 *
 * - one asset in, cash out: a buy, cost = everything that left the account (fee included).
 * - one asset out, cash in: a sell, proceeds = the cash that came in.
 * - several assets in, cash out and nothing out: a multi-leg plan sent straight from the smart
 *   account (BNB Chain's direct path swaps cash into every holding in ONE transaction). It used to
 *   be dropped as a "multi-asset route", so those holdings had no cost basis and the Owned chart
 *   missed them. Each leg's cost is the cash split by the value it received (`priceOf` x qty, the
 *   best weighting available from transfers alone; equal when no price is known).
 * - anything else (deposits, sends, routes with assets out too) is not a priced trade.
 */
export function manualTrades(
  groups: Iterable<TxGroup>,
  opts: {
    knownSymbols: ReadonlySet<string>;
    safeSymbols: ReadonlySet<string>;
    veraTxs: ReadonlySet<string>;
    priceOf?: (symbol: string) => number | undefined;
  },
): Trade[] {
  const { knownSymbols: known, safeSymbols: safe, veraTxs, priceOf } = opts;
  const out: Trade[] = [];
  for (const g of groups) {
    if (veraTxs.has(g.hash)) continue;
    const ins = [...g.assetIn].filter(([s]) => known.has(s));
    const outs = [...g.assetOut].filter(([s]) => known.has(s));
    if (ins.length === 1 && outs.length === 0 && g.usdcOut > 0) {
      const [symbol, qty] = ins[0];
      // Aave supply is 1:1 by construction; everything else cost what left the account, fee included.
      const usdc = safe.has(symbol) ? qty : g.usdcOut + g.feeOut;
      out.push({ symbol, txHash: g.hash, at: g.at, qty, usdc: Math.round(usdc * 1e6) / 1e6, kind: "manual", side: "buy" });
    } else if (ins.length > 1 && outs.length === 0 && g.usdcOut > 0) {
      const total = g.usdcOut + g.feeOut;
      const weights = ins.map(([symbol, qty]) => qty * (priceOf?.(symbol) ?? 0));
      const weightSum = weights.reduce((s, w) => s + w, 0);
      ins.forEach(([symbol, qty], i) => {
        const share = weightSum > 0 ? weights[i] / weightSum : 1 / ins.length;
        out.push({ symbol, txHash: g.hash, at: g.at, qty, usdc: Math.round(total * share * 1e6) / 1e6, kind: "manual", side: "buy" });
      });
    } else if (outs.length === 1 && ins.length === 0 && g.usdcIn > 0) {
      const [symbol, qty] = outs[0];
      out.push({ symbol, txHash: g.hash, at: g.at, qty, usdc: g.usdcIn, kind: "manual", side: "sell" });
    }
    // Deposits, sends, routes with assets out too: not a priced trade, ignored.
  }
  return out;
}
