// runAutopilot's rule branch: once planAutopilotRun returns a rule-based plan (kind: "rule"),
// the executor turns its buy intents into the same Allocation-shaped input buildLegs already
// knows how to sign and submit — no new leg-building code, just a different source for the
// Allocation. A sell intent is refused rather than guessed at (see rulesEngine.ts's header: no
// stream owns a live per-asset balance reader yet, so nothing here can safely price a sell).
// Every dependency below is mocked; this test never touches a chain, Privy, or the DB.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const planAutopilotRunSpy = vi.fn();
vi.mock("./autopilotPlan", () => ({ planAutopilotRun: (...args: unknown[]) => planAutopilotRunSpy(...args) }));

const readContractSpy = vi.fn().mockResolvedValue(BigInt(1_000_000_000_000_000_000_000)); // 1000 USDT (18 dec)
vi.mock("./chain", () => ({ serverClient: () => ({ readContract: readContractSpy }) }));

const recordRunSpy = vi.fn().mockResolvedValue(undefined);
const logRunSpy = vi.fn().mockResolvedValue(undefined);
const pauseAutopilotSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("./autopilotStore", () => ({
  recordRun: (...args: unknown[]) => recordRunSpy(...args),
  logRun: (...args: unknown[]) => logRunSpy(...args),
  pauseAutopilot: (...args: unknown[]) => pauseAutopilotSpy(...args),
}));

const buildLegsSpy = vi.fn();
vi.mock("@/lib/legBuilder", () => ({ buildLegs: (...args: unknown[]) => buildLegsSpy(...args) }));

const { BYTES32_A, BYTES32_B, SIG_65 } = vi.hoisted(() => ({
  BYTES32_A: `0x${"11".repeat(32)}`,
  BYTES32_B: `0x${"22".repeat(32)}`,
  SIG_65: `0x${"33".repeat(65)}`,
}));
vi.mock("@/lib/eip712", () => ({
  buildPlanId: () => BYTES32_A,
  recHash: () => BYTES32_B,
  signRiskInference: vi.fn().mockResolvedValue(SIG_65),
}));

const { sendUserOperationSpy, waitForReceiptSpy } = vi.hoisted(() => ({
  sendUserOperationSpy: vi.fn().mockResolvedValue("0xuserop"),
  waitForReceiptSpy: vi.fn().mockResolvedValue({ success: true, receipt: { transactionHash: "0xtx" } }),
}));
vi.mock("./privySmartAccount", () => ({
  getServerSmartAccountClient: vi.fn().mockResolvedValue({
    account: "account",
    smartAccountClient: { sendUserOperation: sendUserOperationSpy, waitForUserOperationReceipt: waitForReceiptSpy },
  }),
}));

import { runAutopilot } from "./autopilotExecutor";
import { getChain } from "@/lib/chains";
import type { AutopilotConfig } from "@/lib/autopilot";
import type { StaxChain } from "@/lib/chains/types";

const bsc = getChain("bsc");
const deployedBsc: StaxChain = { ...bsc, contracts: { ...bsc.contracts, deployed: true } };
const NOW_S = Math.floor(Date.parse("2026-09-24T15:00:00.000Z") / 1000);

function cfg(overrides: Partial<AutopilotConfig> = {}): AutopilotConfig {
  return {
    id: "ap_1",
    userId: "u1",
    walletId: "w1",
    owner: "0x1111111111111111111111111111111111111111",
    smartAccount: "0x2222222222222222222222222222222222222222",
    chain: "bsc",
    goal: "stax:rule:v1:{\"type\":\"buy_discount\",\"symbol\":\"NVDA\",\"discountPct\":2}::Buy NVDA cheap",
    basketId: null,
    amountUsd: 25,
    cadence: "weekly",
    riskCeilingBps: 6000,
    maxPerPeriodUsd: 50,
    active: true,
    createdAt: NOW_S,
    nextRunAt: NOW_S,
    runs: 0,
    spentThisPeriod: 0,
    ...overrides,
  };
}

beforeEach(() => {
  planAutopilotRunSpy.mockReset();
  readContractSpy.mockClear();
  recordRunSpy.mockReset().mockResolvedValue(undefined);
  logRunSpy.mockReset().mockResolvedValue(undefined);
  pauseAutopilotSpy.mockReset().mockResolvedValue(undefined);
  buildLegsSpy.mockReset();
  sendUserOperationSpy.mockClear();
  waitForReceiptSpy.mockClear();
});

describe("runAutopilot: a rule plan that refuses", () => {
  it("logs the refusal and stops, without touching legs or signing", async () => {
    planAutopilotRunSpy.mockResolvedValue({ ok: false, kind: "rule", status: "skipped", reason: "No discount right now." });

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result).toEqual({ ok: false, reason: "No discount right now." });
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", reason: "No discount right now." }));
    expect(buildLegsSpy).not.toHaveBeenCalled();
  });
});

describe("runAutopilot: a rule plan with nothing to do", () => {
  it("logs a success receipt and never builds or signs anything", async () => {
    planAutopilotRunSpy.mockResolvedValue({ ok: true, kind: "rule", rule: { type: "buy_discount", symbol: "NVDA", discountPct: 2 }, intents: [], receipt: "Vera checked your plan: already on target, nothing to do." });

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result).toEqual({ ok: true });
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "success", reason: expect.stringContaining("nothing to do") }));
    expect(buildLegsSpy).not.toHaveBeenCalled();
  });
});

describe("runAutopilot: a rule plan with a sell leg", () => {
  it("refuses rather than guess a sell amount, and never builds or signs anything", async () => {
    planAutopilotRunSpy.mockResolvedValue({
      ok: true,
      kind: "rule",
      rule: { type: "rebalance", driftPct: 10 },
      intents: [{ symbol: "NVDA", action: "sell", usd: 15, reason: "x" }, { symbol: "AMD", action: "buy", usd: 15, reason: "x" }],
      receipt: "Vera rebalanced your basket: sold $15 of NVDA, bought $15 of AMD.",
    });

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/isn't wired up yet/i);
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "error", reason: expect.stringMatching(/isn't wired up yet/i) }));
    expect(buildLegsSpy).not.toHaveBeenCalled();
  });
});

describe("runAutopilot: a rule plan with buy-only intents", () => {
  it("builds legs from the intents (as an Allocation), signs, submits, and records the receipt", async () => {
    planAutopilotRunSpy.mockResolvedValue({
      ok: true,
      kind: "rule",
      rule: { type: "buy_discount", symbol: "NVDA", discountPct: 2 },
      intents: [{ symbol: "NVDA", action: "buy", usd: 25, reason: "NVDA is cheap" }],
      receipt: "Vera bought the discount: bought $25 of NVDA.",
    });
    buildLegsSpy.mockResolvedValue({
      legs: [{ router: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5", tokenOut: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", usdcIn: BigInt(1), minOut: BigInt(1), swapData: "0x" }],
      notes: [],
    });

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result).toEqual({ ok: true, txHash: "0xtx" });
    const [{ allocation, usdcTotal }] = buildLegsSpy.mock.calls[0];
    expect(allocation.allocations).toEqual([expect.objectContaining({ symbol: "NVDA", weightPct: 100 })]);
    expect(usdcTotal).toBeGreaterThan(BigInt(0));
    expect(sendUserOperationSpy).toHaveBeenCalledTimes(1);
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "success", txHash: "0xtx", reason: expect.stringContaining("NVDA") }));
  });
});
