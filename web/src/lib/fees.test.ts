// ADR-0007: no Stax fee on BSC. Every fee function takes an optional chain key and must zero
// out for "bsc" while staying byte-identical to today's behaviour when nothing is passed — the
// existing Base/Mantle call sites (PlanScreen, AutopilotScreen, GiftScreen, invest-plan route,
// autopilotExecutor, positions) call these with no chain key at all and must never regress.
import { describe, expect, it } from "vitest";
import { feeOf, feeUsd, netOf, STAX_FEE_BPS } from "./fees";

const raw = (usdc: number) => BigInt(Math.round(usdc * 1_000_000));

describe("feeOf", () => {
  it("charges the configured bps when no chain is given (existing callers)", () => {
    expect(feeOf(raw(100))).toBe((raw(100) * BigInt(STAX_FEE_BPS)) / BigInt(10_000));
  });

  it("charges the same on Base and Mantle as with no chain at all", () => {
    expect(feeOf(raw(100), "base")).toBe(feeOf(raw(100)));
    expect(feeOf(raw(100), "mantle")).toBe(feeOf(raw(100)));
  });

  it("is zero on BSC, whatever the amount", () => {
    expect(feeOf(raw(100), "bsc")).toBe(BigInt(0));
    expect(feeOf(BigInt(10) * BigInt(10) ** BigInt(18), "bsc")).toBe(BigInt(0));
  });
});

describe("netOf", () => {
  it("returns the full amount on BSC (no fee taken off)", () => {
    expect(netOf(raw(250), "bsc")).toBe(raw(250));
  });

  it("still deducts the fee with no chain given", () => {
    expect(netOf(raw(100))).toBe(raw(100) - feeOf(raw(100)));
  });
});

describe("feeUsd", () => {
  it("is zero on BSC", () => {
    expect(feeUsd(500, "bsc")).toBe(0);
  });

  it("matches today's percentage with no chain given", () => {
    expect(feeUsd(500)).toBe((500 * STAX_FEE_BPS) / 10_000);
  });
});
