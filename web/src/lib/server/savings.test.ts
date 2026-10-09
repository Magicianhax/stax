// savings.ts turns the DeFi API into "Savings": a rate that never invents a number when Binance
// can't answer, and deposit/redeem calls built to the same safety bar as a buy — Binance's own
// approve calldata is never trusted, and every remaining call is decoded and checked against the
// pinned Venus vUSDT contract before a client ever sees it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { ERC20_ABI } from "@/lib/abis";

vi.mock("server-only", () => ({}));
const investmentDetail = vi.fn();
const buildDeposit = vi.fn();
const buildRedeem = vi.fn();
vi.mock("./binance/defi", () => ({ investmentDetail, buildDeposit, buildRedeem }));

import { getChain } from "@/lib/chains";
import { usdToRaw } from "@/lib/units";
import { VENUS_VUSDT_ADDRESS } from "@/lib/execution";

const bsc = getChain("bsc");
const base = getChain("base");
const ADDR = "0xF977814e90dA44bFA03b6295A0616a897441aceC" as const;
const ATTACKER = "0x000000000000000000000000000000000000dEaD" as const;
const MAX_UINT256 = BigInt(2) ** BigInt(256) - BigInt(1);

// A tiny stand-in for the vUSDT ABI savings.ts decodes against internally — built independently
// here so these tests exercise the real calldata bytes, not an assumption about the source file.
const VTOKEN_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "mintAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "redeemTokens", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "redeemUnderlying", stateMutability: "nonpayable", inputs: [{ name: "redeemAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

function mintCall(amount: bigint, to: `0x${string}` = VENUS_VUSDT_ADDRESS) {
  return { to, data: encodeFunctionData({ abi: VTOKEN_ABI, functionName: "mint", args: [amount] }), value: "0" };
}
function approveCall(spender: `0x${string}`, amount: bigint, to: `0x${string}` = bsc.usdc.address) {
  return { to, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] }) };
}
function transferCall(to: `0x${string}`, amount: bigint) {
  return { to: bsc.usdc.address, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [to, amount] }) };
}

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

  it("builds its own exact-amount approve plus Binance's verified mint call", async () => {
    const amountRaw = usdToRaw(bsc, 10);
    buildDeposit.mockResolvedValueOnce([mintCall(amountRaw)]);
    const { buildSavingsDeposit } = await import("./savings");
    const calls = await buildSavingsDeposit(bsc, ADDR, 10);
    expect(calls).toHaveLength(2);
    const approve = decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data });
    expect(calls[0].to.toLowerCase()).toBe(bsc.usdc.address.toLowerCase());
    expect(approve.functionName).toBe("approve");
    expect(approve.args).toEqual([VENUS_VUSDT_ADDRESS, amountRaw]);
    expect(calls[1]).toEqual(mintCall(amountRaw));
  });

  it("pins $6 to exactly 6 * 10**18 in the approve it builds and the mint it checks", async () => {
    const sixTokens = BigInt(6) * BigInt(10) ** BigInt(18);
    buildDeposit.mockResolvedValueOnce([mintCall(sixTokens)]);
    const { buildSavingsDeposit } = await import("./savings");
    const calls = await buildSavingsDeposit(bsc, ADDR, 6);
    const approve = decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data });
    expect(approve.args[1]).toBe(sixTokens);
  });

  it("sends the pinned Venus USDT investmentId and human-decimal amount, never a value the caller can steer", async () => {
    buildDeposit.mockResolvedValueOnce([mintCall(usdToRaw(bsc, 10))]);
    const { buildSavingsDeposit, VENUS_USDT_INVESTMENT_ID } = await import("./savings");
    await buildSavingsDeposit(bsc, ADDR, 10);
    expect(buildDeposit).toHaveBeenCalledWith(expect.objectContaining({ investmentId: VENUS_USDT_INVESTMENT_ID, amountHuman: "10" }));
  });

  it("ignores Binance's own approve leg entirely and never forwards its bytes", async () => {
    const amountRaw = usdToRaw(bsc, 10);
    // Binance's approve targets the attacker, for a max amount — this must never reach the client
    // in any form, not even re-validated, because deposit always rebuilds its own approve.
    buildDeposit.mockResolvedValueOnce([approveCall(ATTACKER, MAX_UINT256, bsc.usdc.address), mintCall(amountRaw)]);
    const { buildSavingsDeposit } = await import("./savings");
    const calls = await buildSavingsDeposit(bsc, ADDR, 10);
    expect(calls).toHaveLength(2);
    const approve = decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data });
    expect(approve.args).toEqual([VENUS_VUSDT_ADDRESS, amountRaw]);
  });

  it("throws when Binance's response is only an approve to another spender", async () => {
    buildDeposit.mockResolvedValueOnce([approveCall(ATTACKER, usdToRaw(bsc, 10))]);
    const { buildSavingsDeposit } = await import("./savings");
    await expect(buildSavingsDeposit(bsc, ADDR, 10)).rejects.toThrow();
  });

  it("throws when Binance's response is only a max approve", async () => {
    buildDeposit.mockResolvedValueOnce([approveCall(VENUS_VUSDT_ADDRESS, MAX_UINT256)]);
    const { buildSavingsDeposit } = await import("./savings");
    await expect(buildSavingsDeposit(bsc, ADDR, 10)).rejects.toThrow();
  });

  it("throws when Binance's response is a USDT transfer instead of a deposit", async () => {
    buildDeposit.mockResolvedValueOnce([transferCall(ATTACKER, usdToRaw(bsc, 10))]);
    const { buildSavingsDeposit } = await import("./savings");
    await expect(buildSavingsDeposit(bsc, ADDR, 10)).rejects.toThrow();
  });

  it("throws when the mint amount doesn't match what was requested", async () => {
    buildDeposit.mockResolvedValueOnce([mintCall(usdToRaw(bsc, 10) + BigInt(1))]);
    const { buildSavingsDeposit } = await import("./savings");
    await expect(buildSavingsDeposit(bsc, ADDR, 10)).rejects.toThrow();
  });

  it("throws when the deposit call targets a contract that isn't the pinned Venus address", async () => {
    buildDeposit.mockResolvedValueOnce([mintCall(usdToRaw(bsc, 10), ATTACKER)]);
    const { buildSavingsDeposit } = await import("./savings");
    await expect(buildSavingsDeposit(bsc, ADDR, 10)).rejects.toThrow();
  });

  it("throws when Binance returns more than one non-approve call", async () => {
    const amountRaw = usdToRaw(bsc, 10);
    buildDeposit.mockResolvedValueOnce([mintCall(amountRaw), mintCall(amountRaw)]);
    const { buildSavingsDeposit } = await import("./savings");
    await expect(buildSavingsDeposit(bsc, ADDR, 10)).rejects.toThrow();
  });
});

// 2026-10-09: "Move money out" said "You don't have savings to move out yet" to an account holding
// $25 of vUSDT — Binance's build-redeem (40456) doesn't see smart-account positions. The redeem is
// now built from the on-chain balance, simulated first, and never asks Binance.
describe("buildSavingsRedeem", () => {
  const VBAL = BigInt("94167254163"); // the real account's 941.67 vUSDT (≈ $25.00) on 2026-10-09
  const deps = (balance: bigint, code: bigint | Error = BigInt(0)) => ({
    vUsdtBalance: vi.fn(async () => balance),
    simulateRedeem: vi.fn(async () => {
      if (code instanceof Error) throw code;
      return code;
    }),
  });

  it("refuses a ratio outside (0, 1]", async () => {
    const { buildSavingsRedeem, SavingsRefusal } = await import("./savings");
    await expect(buildSavingsRedeem(bsc, ADDR, 0, deps(VBAL))).rejects.toThrow(SavingsRefusal);
    await expect(buildSavingsRedeem(bsc, ADDR, 1.5, deps(VBAL))).rejects.toThrow(SavingsRefusal);
  });

  it("moves all of it out with one redeem of the whole on-chain vUSDT balance, never asking Binance", async () => {
    const { buildSavingsRedeem } = await import("./savings");
    const d = deps(VBAL);
    const calls = await buildSavingsRedeem(bsc, ADDR, 1, d);
    expect(buildRedeem).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].to.toLowerCase()).toBe(VENUS_VUSDT_ADDRESS.toLowerCase());
    const decoded = decodeFunctionData({
      abi: [{ type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "redeemTokens", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] }] as const,
      data: calls[0].data,
    });
    expect(decoded.args[0]).toBe(VBAL);
    expect(d.simulateRedeem).toHaveBeenCalledWith(bsc, ADDR, VBAL);
  });

  it("redeems the asked share of the balance", async () => {
    const { buildSavingsRedeem } = await import("./savings");
    const d = deps(BigInt(1000));
    await buildSavingsRedeem(bsc, ADDR, 0.25, d);
    expect(d.simulateRedeem).toHaveBeenCalledWith(bsc, ADDR, BigInt(250));
  });

  it("says there's nothing to move out only when the account really holds no vUSDT", async () => {
    const { buildSavingsRedeem, SavingsRefusal } = await import("./savings");
    await expect(buildSavingsRedeem(bsc, ADDR, 1, deps(BigInt(0)))).rejects.toThrow(SavingsRefusal);
    await expect(buildSavingsRedeem(bsc, ADDR, 1, deps(BigInt(0)))).rejects.toThrow(/don't have savings/);
  });

  it("never returns a redeem Venus would answer with an error code instead of a revert", async () => {
    const { buildSavingsRedeem, SavingsRefusal } = await import("./savings");
    await expect(buildSavingsRedeem(bsc, ADDR, 1, deps(VBAL, BigInt(14)))).rejects.toThrow(SavingsRefusal);
    await expect(buildSavingsRedeem(bsc, ADDR, 1, deps(VBAL, new Error("execution reverted")))).rejects.toThrow(SavingsRefusal);
  });

  it("is BNB Chain only", async () => {
    const { buildSavingsRedeem, SavingsRefusal } = await import("./savings");
    await expect(buildSavingsRedeem(getChain("base"), ADDR, 1, deps(VBAL))).rejects.toThrow(SavingsRefusal);
  });
});

// Review fix (wave 5b): nothing read the vUSDT balance at all before this — a deposit looked like
// the money had vanished, since neither the card nor the portfolio total accounted for it.
describe("vUsdtRawToUnderlyingRaw", () => {
  it("reproduces the LIVE deposit preview (docs/BINANCE-WEB3.md §5a): 6 USDT minted 226.3005974 vUSDT", async () => {
    const { vUsdtRawToUnderlyingRaw } = await import("./savings");
    // The exact exchangeRateStored this codebase read live from the real BSC contract.
    const rate = BigInt("265149227449423179440324562");
    const vTokenRaw = BigInt("22630059740"); // 226.3005974 vUSDT, 8 decimals
    const underlyingRaw = vUsdtRawToUnderlyingRaw(vTokenRaw, rate);
    // Slightly above 6e18 because the rate quoted here is from a later, live read (interest had
    // accrued since the $6 deposit that produced this vUSDT amount) — never exactly 6.
    expect(underlyingRaw).toBeGreaterThan(usdToRaw(bsc, 6));
    expect(underlyingRaw).toBeLessThan(usdToRaw(bsc, 7));
  });

  it("is exact for a rate of exactly 1e18 (1:1)", async () => {
    const { vUsdtRawToUnderlyingRaw } = await import("./savings");
    const oneToOne = BigInt(10) ** BigInt(18);
    expect(vUsdtRawToUnderlyingRaw(BigInt(500), oneToOne)).toBe(BigInt(500));
  });
});

describe("getSavingsBalanceUsd", () => {
  it("returns null off BSC before reading anything", async () => {
    const { getSavingsBalanceUsd } = await import("./savings");
    const vUsdtBalance = vi.fn();
    const vUsdtExchangeRateStored = vi.fn();
    const result = await getSavingsBalanceUsd(base, ADDR, { vUsdtBalance, vUsdtExchangeRateStored });
    expect(result).toBeNull();
    expect(vUsdtBalance).not.toHaveBeenCalled();
  });

  it("returns null (not $0) when the wallet holds no vUSDT", async () => {
    const { getSavingsBalanceUsd } = await import("./savings");
    const result = await getSavingsBalanceUsd(bsc, ADDR, {
      vUsdtBalance: async () => BigInt(0),
      vUsdtExchangeRateStored: async () => BigInt(10) ** BigInt(18),
    });
    expect(result).toBeNull();
  });

  it("converts a real vUSDT balance to dollars using the live exchange rate", async () => {
    const { getSavingsBalanceUsd } = await import("./savings");
    const result = await getSavingsBalanceUsd(bsc, ADDR, {
      vUsdtBalance: async () => BigInt("22630059740"),
      vUsdtExchangeRateStored: async () => BigInt("265149227449423179440324562"),
    });
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(6.0007, 2);
  });

  it("returns null, never throws, when the RPC read fails", async () => {
    const { getSavingsBalanceUsd } = await import("./savings");
    const result = await getSavingsBalanceUsd(bsc, ADDR, {
      vUsdtBalance: async () => {
        throw new Error("RPC timeout");
      },
      vUsdtExchangeRateStored: async () => BigInt(10) ** BigInt(18),
    });
    expect(result).toBeNull();
  });
});
