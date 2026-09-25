// Every "* 1_000_000" in Stax assumed 6-decimal USDC. On BSC cash has 18 decimals, and the
// same line is a 10^12x error. These helpers are the only sanctioned conversion.
import { describe, expect, it } from "vitest";
import { rawToUsd, usdToRaw } from "./units";

const six = { usdc: { address: "0x1" as const, symbol: "USDC" as const, decimals: 6 } };
const eighteen = { usdc: { address: "0x2" as const, symbol: "USDT" as const, decimals: 18 } };

describe("usdToRaw", () => {
  it("converts at 6 decimals", () => {
    expect(usdToRaw(six, 10)).toBe(BigInt(10_000_000));
    expect(usdToRaw(six, 0.01)).toBe(BigInt(10_000));
  });

  it("converts at 18 decimals without floating-point drift", () => {
    expect(usdToRaw(eighteen, 10)).toBe(BigInt(10) * BigInt(10) ** BigInt(18));
    expect(usdToRaw(eighteen, 6.5)).toBe(BigInt(65) * BigInt(10) ** BigInt(17));
    expect(usdToRaw(eighteen, 0.1)).toBe(BigInt(10) ** BigInt(17));
  });

  it("rounds to the micro-dollar, never beyond it", () => {
    expect(usdToRaw(eighteen, 1.2345678)).toBe(BigInt(1_234_568) * BigInt(10) ** BigInt(12));
  });

  it("refuses negative and non-finite amounts", () => {
    expect(() => usdToRaw(six, -1)).toThrow();
    expect(() => usdToRaw(six, Number.NaN)).toThrow();
    expect(() => usdToRaw(six, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("rawToUsd", () => {
  it("reads back what usdToRaw wrote, at both precisions", () => {
    expect(rawToUsd(six, usdToRaw(six, 42.5))).toBe(42.5);
    expect(rawToUsd(eighteen, usdToRaw(eighteen, 42.5))).toBe(42.5);
  });
});
