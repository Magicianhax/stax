// dryRunBscSwap is the one place that decides whether a BSC trade gets an honest "Checked
// with Binance" before the user signs it. The known obstacle (docs/BINANCE-WEB3.md §5, §10):
// `/pre-transaction/simulate` takes ONE unsigned tx, no bundle/list and no state override, so
// a swap from an account that hasn't approved the router yet reverts on the very first
// `transferFrom` — before the output leg ever runs (§10, point 1, resolved live against a real
// $6 USDT->NVDAB quote). Simulating that swap alone would only ever prove the allowance
// failure, never the trade itself, so this file never sends it to Binance until the on-chain
// allowance already covers the trade — otherwise it says so plainly and skips, and NEVER
// reports "passed" for a check that didn't run. Binance itself is stubbed throughout; no key
// is loaded and no network call is made in tests.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { encodeFunctionData } from "viem";
import { ERC20_ABI } from "@/lib/abis";
import { getChain } from "@/lib/chains";
import { usdToRaw } from "@/lib/units";
import {
  decodeApproveAmount,
  dryRunBscSwap,
  needsApprovalFirst,
  pairLegCalls,
  parseReceivedAmount,
  plainFailReason,
} from "./dryRun";
import type { SimulateResult } from "./binance/types";

const bsc = getChain("bsc");
const ROUTER = bsc.routers.binance!;
// A placeholder token address (not a real contract) — low-entropy hex like the other test
// addresses in this file, so it reads as a fixture, not a credential.
const TOKEN_OUT = "0x33333333333333333333333333333333333333cc" as const;
const TAKER = "0x1111111111111111111111111111111111111a" as const;
const AMOUNT_IN = usdToRaw(bsc, 10);

function args(overrides: Partial<Parameters<typeof dryRunBscSwap>[0]> = {}) {
  return {
    chain: bsc,
    taker: TAKER,
    router: ROUTER,
    tokenIn: bsc.usdc.address,
    tokenOut: TOKEN_OUT,
    amountIn: AMOUNT_IN,
    swapData: "0xdeadbeef" as const,
    ...overrides,
  };
}

const success: SimulateResult = {
  status: "SUCCESS",
  failReason: "",
  balanceChanges: [{ contractAddress: TOKEN_OUT, tokenType: "ERC20", change: "340000000000000000", owner: TAKER }],
  allowanceChanges: [],
};

describe("needsApprovalFirst", () => {
  it("is true when the current allowance doesn't cover the trade", () => {
    expect(needsApprovalFirst(BigInt(0), BigInt(100))).toBe(true);
    expect(needsApprovalFirst(BigInt(50), BigInt(100))).toBe(true);
  });

  it("is false once the allowance already covers it", () => {
    expect(needsApprovalFirst(BigInt(100), BigInt(100))).toBe(false);
    expect(needsApprovalFirst(BigInt(200), BigInt(100))).toBe(false);
  });
});

describe("parseReceivedAmount", () => {
  it("reads the taker's own positive change in the output token", () => {
    const raw = parseReceivedAmount(
      [
        { contractAddress: bsc.usdc.address, tokenType: "ERC20", change: "-10000000000000000000", owner: TAKER },
        { contractAddress: TOKEN_OUT, tokenType: "ERC20", change: "340000000000000000", owner: TAKER },
      ],
      TOKEN_OUT,
      TAKER,
    );
    expect(raw).toBe(BigInt("340000000000000000"));
  });

  it("ignores another owner's change in the same token", () => {
    const other = "0x2222222222222222222222222222222222222b";
    const raw = parseReceivedAmount(
      [{ contractAddress: TOKEN_OUT, tokenType: "ERC20", change: "999", owner: other }],
      TOKEN_OUT,
      TAKER,
    );
    expect(raw).toBeUndefined();
  });

  it("returns undefined when the output token never shows up", () => {
    expect(parseReceivedAmount([], TOKEN_OUT, TAKER)).toBeUndefined();
  });
});

describe("plainFailReason", () => {
  it("never echoes a raw Solidity/BEP20 revert string", () => {
    const reason = plainFailReason("execution reverted: BEP20: transfer amount exceeds allowance");
    expect(reason).not.toMatch(/BEP20|revert/i);
    expect(reason.length).toBeGreaterThan(0);
  });

  it("has a calm fallback for an empty reason", () => {
    expect(plainFailReason("")).toBeTruthy();
  });
});

describe("dryRunBscSwap", () => {
  it("skips — never 'passed' — when the account hasn't approved the router, and never calls Binance", async () => {
    const simulate = vi.fn();
    const result = await dryRunBscSwap(args(), { readAllowance: async () => BigInt(0), simulate });
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/approve/i);
    expect(simulate).not.toHaveBeenCalled();
  });

  it("simulates and passes once the allowance already covers the trade", async () => {
    const simulate = vi.fn().mockResolvedValue(success);
    const result = await dryRunBscSwap(args(), { readAllowance: async () => AMOUNT_IN, simulate });
    expect(result.status).toBe("passed");
    expect(result.receiveRaw).toBe("340000000000000000");
    expect(result.token).toBe(TOKEN_OUT);
    expect(simulate).toHaveBeenCalledWith({ from: TAKER, to: ROUTER, value: "0", data: "0xdeadbeef" });
  });

  it("fails — and the caller must not send it — when Binance says the trade would revert", async () => {
    const simulate = vi.fn().mockResolvedValue({ ...success, status: "FAILED", failReason: "execution reverted: TRANSFER_FAILED", balanceChanges: [] });
    const result = await dryRunBscSwap(args(), { readAllowance: async () => AMOUNT_IN, simulate });
    expect(result.status).toBe("failed");
    expect(result.reason).toBeTruthy();
    expect(result.reason).not.toMatch(/revert/i);
  });

  it("skips without blocking the trade when Binance can't be reached", async () => {
    const simulate = vi.fn().mockRejectedValue(new Error("timed out"));
    const result = await dryRunBscSwap(args(), { readAllowance: async () => AMOUNT_IN, simulate });
    expect(result.status).toBe("skipped");
  });

  it("skips without blocking the trade when the on-chain allowance read itself fails", async () => {
    const simulate = vi.fn();
    const result = await dryRunBscSwap(args(), {
      readAllowance: async () => {
        throw new Error("rpc down");
      },
      simulate,
    });
    expect(result.status).toBe("skipped");
    expect(simulate).not.toHaveBeenCalled();
  });

  it("stamps checkedAt with the time of the Binance call", async () => {
    const before = Date.now();
    const simulate = vi.fn().mockResolvedValue(success);
    const result = await dryRunBscSwap(args(), { readAllowance: async () => AMOUNT_IN, simulate });
    expect(result.checkedAt).toBeGreaterThanOrEqual(before);
  });
});

// /api/invest-plan's direct path returns exactly [approve, swap] per leg (directCallsForLeg in
// binanceLegs.ts) — these two helpers let invest-plan pair those calls back up into one dry
// run per leg without importing anything from bscPlan.ts (owned by another stream this wave).
describe("pairLegCalls", () => {
  it("groups a flat [approve, swap, approve, swap, ...] list into per-leg pairs, in order", () => {
    const a1 = { to: TOKEN_OUT, data: "0x1" as const };
    const s1 = { to: ROUTER, data: "0x2" as const };
    const a2 = { to: bsc.usdc.address, data: "0x3" as const };
    const s2 = { to: ROUTER, data: "0x4" as const };
    expect(pairLegCalls([a1, s1, a2, s2])).toEqual([
      { approve: a1, swap: s1 },
      { approve: a2, swap: s2 },
    ]);
  });

  it("throws rather than silently mis-pair an odd number of calls", () => {
    expect(() => pairLegCalls([{ to: ROUTER, data: "0x1" as const }])).toThrow();
  });
});

describe("decodeApproveAmount", () => {
  it("reads the exact amount an approve(spender, amount) call sets", () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ROUTER, AMOUNT_IN] });
    expect(decodeApproveAmount(data)).toBe(AMOUNT_IN);
  });

  it("returns undefined for calldata that isn't an approve call", () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [ROUTER] });
    expect(decodeApproveAmount(data)).toBeUndefined();
  });

  it("returns undefined for garbage data instead of throwing", () => {
    expect(decodeApproveAmount("0xdeadbeef")).toBeUndefined();
  });
});
