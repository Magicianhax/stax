// savings.ts turns the DeFi API into "Savings": a rate that never invents a number when Binance
// can't answer, and deposit/redeem calls checked against Savings' own pinned allowlist before
// they ever reach a client.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const investmentDetail = vi.fn();
const buildDeposit = vi.fn();
const buildRedeem = vi.fn();
vi.mock("./binance/defi", () => ({ investmentDetail, buildDeposit, buildRedeem }));

import { getChain } from "@/lib/chains";

const bsc = getChain("bsc");
const base = getChain("base");
const ADDR = "0xF977814e90dA44bFA03b6295A0616a897441aceC" as const;

beforeEach(() => {
  vi.resetModules();
  investmentDetail.mockReset();
  buildDeposit.mockReset();
  buildRedeem.mockReset();
});

describe("getSavingsRate", () => {
  it("returns the live apy when the investment is investable", async () => {
    investmentDetail.mockResolvedValueOnce({ investable: true, apyBps: 338, apyDisplay: "3.38%" });
    const { getSavingsRate } = await import("./savings");
    const rate = await getSavingsRate();
    expect(rate).toEqual({ apyBps: 338, apyDisplay: "3.38%" });
  });

  it("returns null (never a stale or invented number) when Binance errors", async () => {
    investmentDetail.mockRejectedValueOnce(new Error("network down"));
    const { getSavingsRate } = await import("./savings");
    expect(await getSavingsRate()).toBeNull();
  });

  it("returns null when Binance itself says the investment isn't investable right now", async () => {
    investmentDetail.mockResolvedValueOnce({ investable: false, apyBps: 0, apyDisplay: "0.00%" });
    const { getSavingsRate } = await import("./savings");
    expect(await getSavingsRate()).toBeNull();
  });

  it("caches the rate so a burst of page views doesn't spend the call budget repeatedly", async () => {
    investmentDetail.mockResolvedValueOnce({ investable: true, apyBps: 338, apyDisplay: "3.38%" });
    const { getSavingsRate } = await import("./savings");
    await getSavingsRate();
    await getSavingsRate();
    expect(investmentDetail).toHaveBeenCalledTimes(1);
  });
});

describe("buildSavingsDeposit", () => {
  it("refuses off BSC before ever calling Binance", async () => {
    const { buildSavingsDeposit, SavingsRefusal } = await import("./savings");
    await expect(buildSavingsDeposit(base, ADDR, 10)).rejects.toThrow(SavingsRefusal);
    expect(buildDeposit).not.toHaveBeenCalled();
  });

  it("refuses a zero or negative amount before calling Binance", async () => {
    const { buildSavingsDeposit, SavingsRefusal } = await import("./savings");
    await expect(buildSavingsDeposit(bsc, ADDR, 0)).rejects.toThrow(SavingsRefusal);
    expect(buildDeposit).not.toHaveBeenCalled();
  });

  it("passes calls through the savings allowlist", async () => {
    buildDeposit.mockResolvedValueOnce([{ to: bsc.usdc.address, data: "0x1" }]);
    const { buildSavingsDeposit } = await import("./savings");
    const calls = await buildSavingsDeposit(bsc, ADDR, 10);
    expect(calls).toHaveLength(1);
  });

  it("rejects a call the allowlist doesn't recognize, even though Binance built it", async () => {
    buildDeposit.mockResolvedValueOnce([{ to: "0x000000000000000000000000000000000000dEaD", data: "0x1" }]);
    const { buildSavingsDeposit } = await import("./savings");
    await expect(buildSavingsDeposit(bsc, ADDR, 10)).rejects.toThrow();
  });

  it("sends the pinned Venus USDT investmentId, never a value the caller can steer", async () => {
    buildDeposit.mockResolvedValueOnce([{ to: bsc.usdc.address, data: "0x1" }]);
    const { buildSavingsDeposit, VENUS_USDT_INVESTMENT_ID } = await import("./savings");
    await buildSavingsDeposit(bsc, ADDR, 10);
    expect(buildDeposit).toHaveBeenCalledWith(expect.objectContaining({ investmentId: VENUS_USDT_INVESTMENT_ID, amountHuman: "10" }));
  });
});

describe("buildSavingsRedeem", () => {
  it("refuses a ratio outside (0, 1]", async () => {
    const { buildSavingsRedeem, SavingsRefusal } = await import("./savings");
    await expect(buildSavingsRedeem(bsc, ADDR, 0)).rejects.toThrow(SavingsRefusal);
    await expect(buildSavingsRedeem(bsc, ADDR, 1.5)).rejects.toThrow(SavingsRefusal);
  });

  it("translates Binance's 'no position found' into a plain refusal, not a 500", async () => {
    // Dynamically imported (not a static top-of-file import) so this is the SAME module
    // instance savings.ts itself imports after vi.resetModules() — otherwise `instanceof`
    // inside savings.ts would compare against a different class object and never match.
    const { BinanceWeb3Error } = await import("./binance/types");
    buildRedeem.mockRejectedValueOnce(new BinanceWeb3Error(40456, "no position found for investmentId=x", 200));
    const { buildSavingsRedeem, SavingsRefusal } = await import("./savings");
    await expect(buildSavingsRedeem(bsc, ADDR, 1)).rejects.toThrow(SavingsRefusal);
  });

  it("passes a real redeem through the savings allowlist", async () => {
    buildRedeem.mockResolvedValueOnce([{ to: bsc.usdc.address, data: "0x1" }]);
    const { buildSavingsRedeem } = await import("./savings");
    const calls = await buildSavingsRedeem(bsc, ADDR, 1);
    expect(calls).toHaveLength(1);
  });
});
