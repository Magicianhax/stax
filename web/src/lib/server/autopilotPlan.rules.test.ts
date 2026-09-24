// planAutopilotRun: the entry point autopilotExecutor.ts calls. Routes a config whose `goal`
// carries an encoded rule (lib/rules.ts) to the rule engine; anything else (every existing
// Base/Mantle autopilot, and a BSC one that only ever picked "Buy on a schedule") falls straight
// through to the unchanged `planForAutopilot`. Mirrors allocate.bsc.test.ts's mocking style.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateObjectSpy = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObjectSpy(...args) }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "mock-model" }));

const bscCatalogSnapshotSpy = vi.fn();
vi.mock("./rwaCatalog", () => ({ bscCatalogSnapshot: (...args: unknown[]) => bscCatalogSnapshotSpy(...args) }));

const getSpreadHistorySpy = vi.fn();
vi.mock("./spreadStore", () => ({ getSpreadHistory: (...args: unknown[]) => getSpreadHistorySpy(...args) }));

// basketsStore pulls in the Neon/Drizzle client, which needs a real DATABASE_URL at import time.
// Nothing under test here saves or reads a personal (stored) basket — every fixture uses a
// curated id, resolved entirely in code — so the store is stubbed out rather than touched.
vi.mock("./basketsStore", () => ({ getBasket: vi.fn().mockResolvedValue(null) }));

import { planAutopilotRun } from "./autopilotPlan";
import { encodeRuleGoal } from "@/lib/rules";
import { getChain } from "@/lib/chains";
import type { AutopilotConfig } from "@/lib/autopilot";
import type { StaxChain } from "@/lib/chains/types";
import type { RwaTickerView, VenueView } from "@/lib/rwa";

const bsc = getChain("bsc");
/** BSC with the executor flag flipped on, for exercising the rule path (real BSC stays false). */
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
    goal: "Grow my long-term plan",
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

function venue(overrides: Partial<VenueView> = {}): VenueView {
  return {
    platform: "bstock",
    symbol: "NVDAB",
    address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    tokenPrice: 200,
    referencePrice: 200,
    gapPct: -3,
    state: "open",
    buyable: true,
    nextOpenMs: null,
    updatedAt: NOW_S * 1000,
    ...overrides,
  };
}
function ticker(overrides: Partial<RwaTickerView> = {}): RwaTickerView {
  return { ticker: "NVDA", name: "Nvidia", type: "stock", venues: [venue()], bestVenue: "bstock", ...overrides };
}

beforeEach(() => {
  generateObjectSpy.mockReset();
  bscCatalogSnapshotSpy.mockReset();
  getSpreadHistorySpy.mockReset().mockResolvedValue([]);
});

describe("planAutopilotRun: no rule encoded (every existing autopilot)", () => {
  it("stays inert on BSC while the executor isn't deployed, exactly like planForAutopilot", async () => {
    const plan = await planAutopilotRun(cfg(), bsc, NOW_S);
    expect(plan).toEqual({ ok: false, status: "skipped", reason: expect.stringContaining("not deployed") });
    expect(generateObjectSpy).not.toHaveBeenCalled();
  });
});

describe("planAutopilotRun: schedule_buy (unchanged Autopilot DCA)", () => {
  it("unwraps the encoded goal back to plain text and runs the normal goal plan", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW_S * 1000, tickers: [ticker({ venues: [venue({ gapPct: 0 })] })] });
    generateObjectSpy.mockResolvedValue({ object: { summary: "s", rationale: "r", riskScore: 4000, allocations: [{ symbol: "NVDA", weightPct: 100, reason: "why" }] } });

    const encoded = cfg({ goal: encodeRuleGoal({ type: "schedule_buy" }, "Grow my long-term plan") });
    const plan = await planAutopilotRun(encoded, deployedBsc, NOW_S);

    expect(plan.ok).toBe(true);
    // The model saw the human-readable goal, never the encoded blob.
    const { prompt } = generateObjectSpy.mock.calls[0][0] as { prompt: string };
    expect(prompt).toMatch(/Grow my long-term plan/);
    expect(prompt).not.toMatch(/stax:rule:v1/);
  });
});

describe("planAutopilotRun: a real rule", () => {
  it("skips while the executor isn't deployed, even with a rule encoded", async () => {
    const encoded = cfg({ goal: encodeRuleGoal({ type: "buy_discount", symbol: "NVDA", discountPct: 2 }, "Buy NVDA cheap") });
    const plan = await planAutopilotRun(encoded, bsc, NOW_S);
    expect(plan).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("not deployed") }));
    expect(bscCatalogSnapshotSpy).not.toHaveBeenCalled();
  });

  it("runs buy_discount through the rule engine once deployed, never calling Vera", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW_S * 1000, tickers: [ticker({ venues: [venue({ gapPct: -3 })] })] });
    const encoded = cfg({ goal: encodeRuleGoal({ type: "buy_discount", symbol: "NVDA", discountPct: 2 }, "Buy NVDA cheap") });

    const plan = await planAutopilotRun(encoded, deployedBsc, NOW_S);

    expect(plan.ok).toBe(true);
    if (plan.ok && "intents" in plan) {
      expect(plan.intents).toEqual([expect.objectContaining({ symbol: "NVDA", action: "buy" })]);
      expect(plan.receipt).toMatch(/NVDA/);
    }
    expect(generateObjectSpy).not.toHaveBeenCalled();
  });

  it("resolves the config's basket into rebalance targets", async () => {
    const encoded = cfg({
      goal: encodeRuleGoal({ type: "rebalance", driftPct: 10 }, "Keep my basket balanced"),
      basketId: `bsc:us-tech-giants`,
    });

    const plan = await planAutopilotRun(encoded, deployedBsc, NOW_S);

    // No holdings supplied yet (wiringNeeded) — still an honest skip, but it must have found
    // the curated basket's name/targets rather than refusing "pick a basket" outright.
    expect(plan).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("holdings") }));
  });
});
