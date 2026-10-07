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

const fetchWalletsSpy = vi.fn();
vi.mock("./privyAuth", () => ({ fetchPrivyEmbeddedWallets: (...args: unknown[]) => fetchWalletsSpy(...args) }));

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
import { AllocationRefusal } from "./bscPlan";
import { BinanceLegRefusal } from "./binanceLegs";
import { getChain } from "@/lib/chains";
import { signRiskInference } from "@/lib/eip712";
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
  fetchWalletsSpy.mockReset().mockResolvedValue([{ id: "w1", address: "0x1111111111111111111111111111111111111111" }]);
  planAutopilotRunSpy.mockReset();
  readContractSpy.mockClear();
  recordRunSpy.mockReset().mockResolvedValue(undefined);
  logRunSpy.mockReset().mockResolvedValue(undefined);
  pauseAutopilotSpy.mockReset().mockResolvedValue(undefined);
  buildLegsSpy.mockReset();
  sendUserOperationSpy.mockClear();
  waitForReceiptSpy.mockClear();
  vi.mocked(signRiskInference).mockClear();
});

describe("runAutopilot: a rule plan that refuses", () => {
  it("logs the refusal and stops, without touching legs or signing", async () => {
    planAutopilotRunSpy.mockResolvedValue({ ok: false, kind: "rule", status: "skipped", reason: "No discount right now." });

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result).toEqual({ ok: false, reason: "No discount right now.", retryable: false });
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", reason: "No discount right now." }));
    expect(buildLegsSpy).not.toHaveBeenCalled();
  });
});

describe("runAutopilot: a rule plan with nothing to do", () => {
  it("logs a success receipt and never builds or signs anything", async () => {
    planAutopilotRunSpy.mockResolvedValue({ ok: true, kind: "rule", rule: { type: "buy_discount", symbol: "NVDA", discountPct: 2 }, intents: [], receipt: "Vera checked your plan: already on target, nothing to do." });

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result).toEqual({ ok: true, receipt: "Vera checked your plan: already on target, nothing to do." });
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
    // Review finding #1: a 100% single-stock rule buy must be scored like the basket path
    // (lib/baskets.ts's riskScoreFor — NVDA is "stock" tier, 6000bps), never the old
    // hard-coded 0, in both the bounds check above and the signed on-chain inference below.
    expect(allocation.riskScore).toBe(6000);
    expect(signRiskInference).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ assessedRisk: 6000 }));
  });
});

describe("runAutopilot: a rule plan above the user's risk ceiling", () => {
  it("skips at the bounds gate and never signs a fabricated zero-risk inference (review finding #1)", async () => {
    planAutopilotRunSpy.mockResolvedValue({
      ok: true,
      kind: "rule",
      rule: { type: "buy_discount", symbol: "NVDA", discountPct: 2 },
      intents: [{ symbol: "NVDA", action: "buy", usd: 25, reason: "NVDA is cheap" }],
      receipt: "Vera bought the discount: bought $25 of NVDA.",
    });

    // NVDA (stock tier) scores 6000bps; a "Careful" 4000bps ceiling must refuse it, exactly the
    // regression the reviewer found (the old riskScore: 0 sailed straight through this gate).
    const result = await runAutopilot(cfg({ riskCeilingBps: 4000 }), { nowSeconds: NOW_S }, deployedBsc);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/risk ceiling/i);
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", assessedRiskBps: 6000, reason: expect.stringMatching(/risk ceiling/i) }));
    expect(buildLegsSpy).not.toHaveBeenCalled();
    expect(signRiskInference).not.toHaveBeenCalled();
    expect(sendUserOperationSpy).not.toHaveBeenCalled();
  });
});

describe("runAutopilot: a refusal Stax's own planning rules make", () => {
  it("logs a closed market as skipped, so Activity shows it, and doesn't ask the cron to retry", async () => {
    planAutopilotRunSpy.mockRejectedValue(new AllocationRefusal("The market is closed right now; it opens Mon 9:30am ET."));

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result).toEqual({ ok: false, reason: "The market is closed right now; it opens Mon 9:30am ET.", retryable: false });
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", reason: expect.stringContaining("closed") }));
  });

  it("logs an under-$6 leg as skipped, in Autopilot words rather than 'Enter $6 or more'", async () => {
    planAutopilotRunSpy.mockResolvedValue({
      ok: true,
      kind: "rule",
      rule: { type: "safety_switch", dropPct: 3, movePct: 25 },
      intents: [{ symbol: "SPY", action: "buy", usd: 5, reason: "x" }, { symbol: "QQQ", action: "buy", usd: 5, reason: "x" }],
      receipt: "r",
    });
    buildLegsSpy.mockRejectedValue(new BinanceLegRefusal("The smallest trade is $6. Enter $6 or more.", "min_trade"));

    const result = await runAutopilot(cfg({ maxPerPeriodUsd: 100 }), { nowSeconds: NOW_S }, deployedBsc);

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.reason).toMatch(/Raise the amount/);
    expect(result.reason).not.toMatch(/Enter \$6/);
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped" }));
    expect(sendUserOperationSpy).not.toHaveBeenCalled();
  });

  it("still throws a real fault, so the cron's retry and the error log see it", async () => {
    planAutopilotRunSpy.mockRejectedValue(new Error("db down"));
    await expect(runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc)).rejects.toThrow("db down");
  });
});

describe("runAutopilot: a run that found nothing to do", () => {
  it("returns the receipt, so Run now can say 'nothing to do' instead of 'Vera invested for you'", async () => {
    planAutopilotRunSpy.mockResolvedValue({ ok: true, kind: "rule", rule: { type: "buy_discount", symbol: "NVDA", discountPct: 2 }, intents: [], receipt: "Vera checked your plan: nothing to do." });
    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);
    expect(result).toEqual({ ok: true, receipt: "Vera checked your plan: nothing to do." });
  });
});

describe("runAutopilot: the signing wallet is re-checked at run time", () => {
  it("pauses and signs nothing when the stored wallet isn't the user's own", async () => {
    fetchWalletsSpy.mockResolvedValue([{ id: "w_other", address: "0x9999999999999999999999999999999999999999" }]);

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
    expect(pauseAutopilotSpy).toHaveBeenCalledWith("ap_1");
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "error", reason: expect.stringMatching(/isn't one of yours/) }));
    expect(planAutopilotRunSpy).not.toHaveBeenCalled();
    expect(sendUserOperationSpy).not.toHaveBeenCalled();
  });

  it("fails closed when Privy can't be reached: skips the run without signing or pausing", async () => {
    fetchWalletsSpy.mockRejectedValue(new Error("privy down"));

    const result = await runAutopilot(cfg(), { nowSeconds: NOW_S }, deployedBsc);

    expect(result.ok).toBe(false);
    expect(pauseAutopilotSpy).not.toHaveBeenCalled();
    expect(logRunSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped" }));
    expect(planAutopilotRunSpy).not.toHaveBeenCalled();
    expect(sendUserOperationSpy).not.toHaveBeenCalled();
  });
});
