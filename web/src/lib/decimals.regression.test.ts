// Regression pin for "remove every 6-decimal assumption" (BNB Hack, Task 5). Every call site
// this task touched (useInvest, useSwap, useGifts, TradeScreen, autopilotExecutor,
// onchainHistory, executorLogs) used to do `amountUsd * 1_000_000` or `raw / 1e6` directly,
// which is exactly right on Base's 6-decimal USDC and exactly 10^12x wrong on BSC's
// 18-decimal USDT. Those hooks and components aren't unit-tested in this repo (no React
// harness — see vitest.config.mts), so this file pins the shared, chain-aware primitives
// they were rewired to call: usdToRaw/rawToUsd (lib/units.ts) and onchainHistory's
// usdcToNumber, which server/executorLogs.ts now also calls instead of its own hardcoded
// divide. A case that only checked Base would pass with the bug still in place, so every
// case below runs at both Base's 6 decimals and BSC's 18.
import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import { getChain } from "./chains";
import { usdcToNumber } from "./onchainHistory";
import { rawToUsd, usdToRaw } from "./units";

describe("cash conversions hold on every chain", () => {
  for (const key of ["base", "bsc"] as const) {
    const chain = getChain(key);
    const decimals = chain.usdc.decimals;

    it(`${key}: $10 of cash is 10 * 10^${decimals} raw units`, () => {
      // The exact expression useInvest/useSwap/useGifts/TradeScreen/autopilotExecutor now
      // call in place of their old hardcoded "* 1_000_000".
      expect(usdToRaw(chain, 10)).toBe(BigInt(10) * BigInt(10) ** BigInt(decimals));
    });

    it(`${key}: an AllocationExecuted leg of $10 decodes back to $10 (onchainHistory.usdcToNumber)`, () => {
      // Mirrors readExecutions() in onchainHistory.ts and readExecutionRows() in
      // server/executorLogs.ts: the raw usdcSpent off the event/indexed row, in this
      // chain's own decimals, must read back as the dollar amount it started as.
      const raw = usdToRaw(chain, 10);
      expect(usdcToNumber(chain, raw)).toBeCloseTo(10, 9);
    });

    it(`${key}: rawToUsd(usdToRaw(x)) round-trips a non-integer dollar amount`, () => {
      expect(rawToUsd(chain, usdToRaw(chain, 42.5))).toBe(42.5);
    });
  }

  it("a 25 USDT deposit on BSC reads back as $25.00", () => {
    // Built independently of usdToRaw (viem's own decimal encoder), so this isn't just the
    // helper checked against itself — it's what a real 18-decimal on-chain deposit looks like.
    const bsc = getChain("bsc");
    const depositRaw = parseUnits("25", bsc.usdc.decimals);
    expect(rawToUsd(bsc, depositRaw)).toBe(25);
  });

  it("never reuses another chain's decimals: the same $10 is 10^12x more raw units on BSC than on Base", () => {
    const base = getChain("base");
    const bsc = getChain("bsc");
    expect(usdToRaw(bsc, 10) / usdToRaw(base, 10)).toBe(BigInt(10) ** BigInt(12));
  });
});
