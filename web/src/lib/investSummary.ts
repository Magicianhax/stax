// What a finished invest bought, for the success screen. A BNB Chain plan can leave out a holding
// Binance had no seller for (lib/legBuilder.ts re-splits its share across the rest), so the
// summary is the plan minus what was skipped, never the plan as reviewed.
import type { Allocation } from "@/lib/allocation-schema";
import type { InvestSuccess } from "@/lib/invest-types";

/** The plan's holdings minus `skipped`, re-weighted to the whole amount the way the server re-split it. */
export function boughtHoldings(alloc: Allocation, amountUsd: number, skipped: readonly string[] = []): InvestSuccess["holdings"] {
  const kept = alloc.allocations.filter((a) => !skipped.includes(a.symbol));
  const total = kept.reduce((s, a) => s + a.weightPct, 0) || 1;
  return kept.map((a) => ({
    symbol: a.symbol,
    name: a.symbol,
    weightPct: Math.round((a.weightPct / total) * 1000) / 10,
    amountUsd: (amountUsd * a.weightPct) / total,
  }));
}

/** "Qualcomm had no seller on Binance just now, so its share went to the others." `nameOf` gives a company name. */
export function skippedLine(symbols: readonly string[], nameOf: (symbol: string) => string): string {
  const names = symbols.map(nameOf);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} had no seller on Binance just now, so ${names.length === 1 ? "its" : "their"} share went to the others.`;
}
