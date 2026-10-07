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

const getBscHoldingsSpy = vi.fn();
vi.mock("./bscHoldings", () => ({ getBscHoldings: (...args: unknown[]) => getBscHoldingsSpy(...args) }));

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
/** BSC with the executor pinned on (real BSC is live since 2026-10-07; pinned so these never drift). */
const deployedBsc: StaxChain = { ...bsc, contracts: { ...bsc.contracts, deployed: true } };
/** A Binance chain with no executor: the gate below must still hold for one. */
const undeployedBsc: StaxChain = { ...bsc, contracts: { ...bsc.contracts, deployed: false } };
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
  // Default: no live holdings read (matches "the read hasn't happened / failed" -> the existing
  // "waiting on your holdings" skip every test below that doesn't care about holdings still gets.
  getBscHoldingsSpy.mockReset().mockResolvedValue(null);
});

describe("planAutopilotRun: no rule encoded (every existing autopilot)", () => {
  it("stays inert on a Binance chain whose executor isn't deployed, exactly like planForAutopilot", async () => {
    const plan = await planAutopilotRun(cfg(), undeployedBsc, NOW_S);
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
    const plan = await planAutopilotRun(encoded, undeployedBsc, NOW_S);
    expect(plan).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("not deployed") }));
    expect(bscCatalogSnapshotSpy).not.toHaveBeenCalled();
  });

  it("runs on real BNB Chain now: its executor is live", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW_S * 1000, tickers: [ticker({ venues: [venue({ gapPct: -3 })] })] });
    const encoded = cfg({ goal: encodeRuleGoal({ type: "buy_discount", symbol: "NVDA", discountPct: 2 }, "Buy NVDA cheap") });
    const plan = await planAutopilotRun(encoded, bsc, NOW_S);
    expect(plan.ok).toBe(true);
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

  it("never decodes a rule off Base/Mantle, even with one encoded in the goal (review finding #3)", async () => {
    // Mantle is always `deployed: true` (unlike Base, which depends on an env var this test
    // shouldn't need) — decoding this would run a rule for real today.
    generateObjectSpy.mockResolvedValue({ object: { summary: "s", rationale: "r", riskScore: 4000, allocations: [{ symbol: "NVDA", weightPct: 100, reason: "why" }] } });
    const mantle = getChain("mantle");
    const encoded = cfg({ chain: "mantle", goal: encodeRuleGoal({ type: "buy_discount", symbol: "NVDA", discountPct: 2 }, "Buy NVDA cheap") });

    const plan = await planAutopilotRun(encoded, mantle, NOW_S);

    expect(plan.ok).toBe(true);
    expect("kind" in plan).toBe(false); // the plain goal/basket plan shape, never the rule-engine one
    expect(bscCatalogSnapshotSpy).not.toHaveBeenCalled();
    // The whole encoded string became Vera's goal verbatim — never parsed as a rule.
    const { prompt } = generateObjectSpy.mock.calls[0][0] as { prompt: string };
    expect(prompt).toMatch(/stax:rule:v1/);
  });

  it("resolves the config's basket into rebalance targets", async () => {
    const encoded = cfg({
      goal: encodeRuleGoal({ type: "rebalance", driftPct: 10 }, "Keep my basket balanced"),
      basketId: `bsc:us-tech-giants`,
    });

    const plan = await planAutopilotRun(encoded, deployedBsc, NOW_S);

    // The live holdings read failed (mocked null above) — still an honest skip, but it must have
    // found the curated basket's name/targets rather than refusing "pick a basket" outright.
    expect(plan).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("holdings") }));
  });

  it("fetches a live holdings read for a holdings-based rule (rebalance), for this config's own smart account", async () => {
    const encoded = cfg({
      goal: encodeRuleGoal({ type: "rebalance", driftPct: 10 }, "Keep my basket balanced"),
      basketId: `bsc:us-tech-giants`,
    });

    await planAutopilotRun(encoded, deployedBsc, NOW_S);

    expect(getBscHoldingsSpy).toHaveBeenCalledWith(deployedBsc, encoded.smartAccount, NOW_S * 1000);
  });

  it("never fetches a holdings read for buy_discount — it doesn't look at holdings at all", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW_S * 1000, tickers: [ticker({ venues: [venue({ gapPct: -3 })] })] });
    const encoded = cfg({ goal: encodeRuleGoal({ type: "buy_discount", symbol: "NVDA", discountPct: 2 }, "Buy NVDA cheap") });

    await planAutopilotRun(encoded, deployedBsc, NOW_S);

    expect(getBscHoldingsSpy).not.toHaveBeenCalled();
  });

  it("acts (buy-only) on a rebalance rule once the live holdings read comes back with a real drift to fix", async () => {
    // NVDA is 100% of the account; the "US Tech Giants" basket targets it at 25% (see
    // lib/baskets.ts) — everything else is underweight from zero.
    getBscHoldingsSpy.mockResolvedValue([{ symbol: "NVDA", usdValue: 100, tier: "stock" }]);
    const encoded = cfg({
      goal: encodeRuleGoal({ type: "rebalance", driftPct: 10 }, "Keep my basket balanced"),
      basketId: `bsc:us-tech-giants`,
      amountUsd: 25,
    });

    const plan = await planAutopilotRun(encoded, deployedBsc, NOW_S);

    expect(plan.ok).toBe(true);
    if (plan.ok && "intents" in plan) {
      expect(plan.intents.length).toBeGreaterThan(0);
      // Buy-only: the executor can't sell the NVDA overweight, so every intent here must be a buy.
      expect(plan.intents.every((i) => i.action === "buy")).toBe(true);
      expect(plan.intents.some((i) => i.symbol === "NVDA")).toBe(false);
    }
  });
});
