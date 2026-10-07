import { describe, expect, it } from "vitest";
import { manualTrades, type TxGroup } from "./manualTrades";

const known = new Set(["NVDA", "MSFT", "BTCB", "aUSDC"]);
const base = { knownSymbols: known, safeSymbols: new Set(["aUSDC"]), veraTxs: new Set<string>() };

function group(over: Partial<TxGroup> & { in?: [string, number][]; out?: [string, number][] }): TxGroup {
  const { in: ins, out: outs, ...rest } = over;
  return {
    hash: "0xaaa",
    at: 100,
    usdcOut: 0,
    usdcIn: 0,
    feeOut: 0,
    assetIn: new Map(ins ?? []),
    assetOut: new Map(outs ?? []),
    ...rest,
  };
}

describe("manualTrades", () => {
  it("books a single-asset buy at everything that left the account", () => {
    const t = manualTrades([group({ usdcOut: 6, feeOut: 0.02, in: [["NVDA", 0.03]] })], base);
    expect(t).toEqual([{ symbol: "NVDA", txHash: "0xaaa", at: 100, qty: 0.03, usdc: 6.02, kind: "manual", side: "buy" }]);
  });

  it("books a single-asset sell at the cash that came in", () => {
    const t = manualTrades([group({ usdcIn: 7, out: [["NVDA", 0.03]] })], base);
    expect(t[0]).toMatchObject({ symbol: "NVDA", usdc: 7, side: "sell" });
  });

  it("splits a multi-leg plan's cash across its holdings by the value each received", () => {
    // One user op swapped $30 into three holdings (BNB Chain's direct path): this used to be dropped.
    const prices: Record<string, number> = { NVDA: 200, MSFT: 400, BTCB: 60_000 };
    const t = manualTrades(
      [group({ usdcOut: 30, in: [["NVDA", 0.03], ["MSFT", 0.015], ["BTCB", 0.0001]] })],
      { ...base, priceOf: (s) => prices[s] },
    );
    expect(t.map((x) => x.symbol)).toEqual(["NVDA", "MSFT", "BTCB"]);
    // values 6, 6, 6 -> $10 each
    for (const x of t) expect(x.usdc).toBeCloseTo(10, 6);
    expect(t.reduce((s, x) => s + x.usdc, 0)).toBeCloseTo(30, 5);
    expect(t.every((x) => x.side === "buy" && x.kind === "manual")).toBe(true);
  });

  it("splits equally when no price is known, and always keeps the total", () => {
    const t = manualTrades([group({ usdcOut: 12, in: [["NVDA", 1], ["MSFT", 2]] })], base);
    expect(t.map((x) => x.usdc)).toEqual([6, 6]);
  });

  it("ignores a route that also sends an asset out, a deposit, and a Vera tx", () => {
    expect(manualTrades([group({ usdcOut: 10, in: [["NVDA", 1], ["MSFT", 1]], out: [["BTCB", 1]] })], base)).toEqual([]);
    expect(manualTrades([group({ in: [["NVDA", 1]] })], base)).toEqual([]);
    expect(manualTrades([group({ usdcOut: 10, in: [["NVDA", 1]] })], { ...base, veraTxs: new Set(["0xaaa"]) })).toEqual([]);
  });
});
