// dryRunBscSwap is the one place that decides whether a BSC trade gets an honest "Checked
// with Binance" before the user signs it. The known obstacle (docs/BINANCE-WEB3.md §5, §10):
// `/pre-transaction/simulate` takes ONE unsigned tx, no bundle/list and no state override
// (both re-confirmed LIVE for wave 5 — see §5), and a swap from an account that hasn't
// approved the router yet reverts on the very first `transferFrom` before the output leg ever
// runs. Simulating the swap alone would therefore only ever prove the allowance failure for
// almost every real trade, since every BSC approval here is exact-amount and single-use
// (directCallsForLeg / useSwap's aggregatorCalls) — the allowance is back to zero right after
// each trade. The fix: simulate what the user's smart account actually signs — the WHOLE
// batch, `executeBatch([approve, swap])` — called from the EntryPoint, exactly as ERC-4337
// delivers it on-chain (EntryPoint.innerHandleOp calls the account directly, so the account
// sees msg.sender == the EntryPoint). The approve and the swap then run atomically in the same
// call, so this works regardless of the account's CURRENT on-chain allowance — first trade of
// a token or the hundredth. The one real limit (confirmed LIVE, §5): Binance's simulator
// rejects a `to` address with no deployed bytecode outright (a clean 40001 "Parameter error",
// not a misleading SUCCESS) — so a smart account that hasn't sent its first on-chain trade yet
// (no code deployed) genuinely cannot be dry-run this way. `isAccountDeployed` catches that
// for free (an RPC read, no Binance budget spent) before ever calling Binance, and the skip
// reason says so honestly instead of blaming approval. Binance itself is stubbed throughout;
// no key is loaded and no network call is made in tests.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { decodeFunctionData, encodeFunctionData } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { ERC20_ABI } from "@/lib/abis";
import { getChain } from "@/lib/chains";
import { usdToRaw } from "@/lib/units";
import {
  decodeApproveAmount,
  dryRunBscSwap,
  encodeSimpleAccountExecuteBatch,
  pairLegCalls,
  parseReceivedAmount,
  plainFailReason,
} from "./dryRun";
import type { SimulateResult } from "./binance/types";

/** Mirrors permissionless.js's SimpleSmartAccount v0.7 executeBatch ABI, for decoding in tests
 *  only — production code never needs to decode it back. */
const EXECUTE_BATCH_07_ABI = [
  {
    inputs: [
      { internalType: "address[]", name: "dest", type: "address[]" },
      { internalType: "uint256[]", name: "value", type: "uint256[]" },
      { internalType: "bytes[]", name: "func", type: "bytes[]" },
    ],
    name: "executeBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

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

describe("encodeSimpleAccountExecuteBatch", () => {
  it("encodes calls a SimpleAccount (EntryPoint v0.7) executeBatch decodes back byte for byte", () => {
    const calls = [
      { to: TOKEN_OUT, data: "0xaaaa" as const },
      { to: ROUTER, data: "0xbbbbbbbb" as const },
    ];
    const data = encodeSimpleAccountExecuteBatch(calls);
    const decoded = decodeFunctionData({ abi: EXECUTE_BATCH_07_ABI, data });
    expect(decoded.functionName).toBe("executeBatch");
    const [dest, value, func] = decoded.args;
    // viem returns EIP-55 checksummed addresses on decode; compare case-insensitively.
    expect(dest.map((a) => a.toLowerCase())).toEqual([TOKEN_OUT.toLowerCase(), ROUTER.toLowerCase()]);
    expect(value).toEqual([BigInt(0), BigInt(0)]);
    expect(func).toEqual(["0xaaaa", "0xbbbbbbbb"]);
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

  it("never asks a first-time investor for an 'approval step' they can't take", () => {
    // Design critique P0 #3: the approve is batched into the same user op, so there is no extra
    // step the person could take — the words only confused them.
    expect(plainFailReason("execution reverted: BEP20: transfer amount exceeds allowance")).not.toMatch(/approval/i);
  });

  it("has a calm fallback for an empty reason", () => {
    expect(plainFailReason("")).toBeTruthy();
  });
});

const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ROUTER, AMOUNT_IN] });
const expectedBatchData = encodeSimpleAccountExecuteBatch([
  { to: bsc.usdc.address, data: approveData },
  { to: ROUTER, data: "0xdeadbeef" },
]);

describe("dryRunBscSwap", () => {
  it("skips — never 'passed' — when the account has no deployed code yet, and never calls Binance", async () => {
    const simulate = vi.fn();
    const result = await dryRunBscSwap(args(), { isAccountDeployed: async () => false, simulate });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBeTruthy();
    expect(result.reason).not.toMatch(/approve/i); // the account isn't deployed, not un-approved — say the true reason
    expect(simulate).not.toHaveBeenCalled();
  });

  it("simulates the whole [approve, swap] batch from the EntryPoint once the account is deployed, and passes", async () => {
    const simulate = vi.fn().mockResolvedValue(success);
    const result = await dryRunBscSwap(args(), { isAccountDeployed: async () => true, simulate });
    expect(result.status).toBe("passed");
    expect(result.receiveRaw).toBe("340000000000000000");
    expect(result.token).toBe(TOKEN_OUT);
    // Simulated exactly as the EntryPoint delivers it on-chain: msg.sender == the EntryPoint,
    // to == the smart account, calldata == the same executeBatch the user will sign — so this
    // works whatever the account's CURRENT allowance is, unlike simulating the swap alone.
    expect(simulate).toHaveBeenCalledWith({ from: entryPoint07Address, to: TAKER, value: "0", data: expectedBatchData });
  });

  it("fails — and the caller must not send it — when Binance says the batch would revert", async () => {
    const simulate = vi.fn().mockResolvedValue({ ...success, status: "FAILED", failReason: "execution reverted: TRANSFER_FAILED", balanceChanges: [] });
    const result = await dryRunBscSwap(args(), { isAccountDeployed: async () => true, simulate });
    expect(result.status).toBe("failed");
    expect(result.reason).toBeTruthy();
    expect(result.reason).not.toMatch(/revert/i);
  });

  it("skips without blocking the trade when Binance can't be reached", async () => {
    const simulate = vi.fn().mockRejectedValue(new Error("timed out"));
    const result = await dryRunBscSwap(args(), { isAccountDeployed: async () => true, simulate });
    expect(result.status).toBe("skipped");
  });

  it("skips without blocking the trade when the deployed-account check itself fails", async () => {
    const simulate = vi.fn();
    const result = await dryRunBscSwap(args(), {
      isAccountDeployed: async () => {
        throw new Error("rpc down");
      },
      simulate,
    });
    expect(result.status).toBe("skipped");
    expect(simulate).not.toHaveBeenCalled();
  });

  it("still says 'skipped', never 'passed', on the account's tenth trade if it somehow still isn't deployed", async () => {
    // Regression guard for the bug this replaces: the OLD allowance-based skip reason said
    // "First trade of this token" even on a user's tenth trade (every approval is exact-amount
    // and single-use, so allowance is always 0 right after a trade). The new reason must never
    // claim it's about approval or about this specific token.
    const simulate = vi.fn();
    const result = await dryRunBscSwap(args(), { isAccountDeployed: async () => false, simulate });
    expect(result.reason).not.toMatch(/first trade of this token/i);
  });

  it("stamps checkedAt with the time of the Binance call", async () => {
    const before = Date.now();
    const simulate = vi.fn().mockResolvedValue(success);
    const result = await dryRunBscSwap(args(), { isAccountDeployed: async () => true, simulate });
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
