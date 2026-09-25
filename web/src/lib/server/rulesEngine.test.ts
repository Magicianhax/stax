// planRuleForAutopilot: wires lib/rules.ts's pure evaluators to the real BSC data this stream
// owns (the RWA catalog for buy_discount, the spread history for the safety switch's market-drop
// trigger). Holdings-based rules (rebalance, mix_keeper, and the rest of safety_switch) need a
// live per-asset balance read that belongs to another stream's Wallet API work (see the file's
// own header and wiringNeeded); until `ctx.holdings` is supplied they report a plain "waiting on
// your holdings" skip rather than fabricate a number — never a fake pass (harness rule + Review
// Focus honesty bar).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const bscCatalogSnapshotSpy = vi.fn();
vi.mock("./rwaCatalog", () => ({ bscCatalogSnapshot: (...args: unknown[]) => bscCatalogSnapshotSpy(...args) }));

const getSpreadHistorySpy = vi.fn();
vi.mock("./spreadStore", () => ({ getSpreadHistory: (...args: unknown[]) => getSpreadHistorySpy(...args) }));
const getNextEarningsSpy = vi.fn();
vi.mock("./earnings", () => ({ getNextEarnings: (...args: unknown[]) => getNextEarningsSpy(...args) }));

import { planRuleForAutopilot } from "./rulesEngine";
import { getChain } from "@/lib/chains";
import type { RwaTickerView, VenueView } from "@/lib/rwa";

const bsc = getChain("bsc");
const NOW = Date.parse("2026-09-24T15:00:00.000Z");
const DAY = 86_400_000;

function venue(overrides: Partial<VenueView> = {}): VenueView {
  return {
    platform: "bstock",
    symbol: "NVDAB",
    address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    tokenPrice: 200,
    referencePrice: 200,
    gapPct: 0,
    state: "open",
    buyable: true,
    nextOpenMs: null,
    updatedAt: NOW,
    ...overrides,
  };
}
function ticker(overrides: Partial<RwaTickerView> = {}): RwaTickerView {
  return { ticker: "NVDA", name: "Nvidia", type: "stock", venues: [venue()], bestVenue: "bstock", ...overrides };
}

beforeEach(() => {
  bscCatalogSnapshotSpy.mockReset();
  getSpreadHistorySpy.mockReset().mockResolvedValue([]);
});

describe("planRuleForAutopilot: buy_discount", () => {
  it("buys when the catalog shows a live discount", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW, tickers: [ticker({ venues: [venue({ gapPct: -3 })] })] });

    const plan = await planRuleForAutopilot(bsc, { type: "buy_discount", symbol: "NVDA", discountPct: 2 }, { nowMs: NOW, budgetUsd: 25 });

    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.intents).toEqual([expect.objectContaining({ symbol: "NVDA", action: "buy", usd: 25 })]);
      expect(plan.receipt).toMatch(/NVDA/);
    }
  });

  it("does nothing (ok, empty) when the catalog shows no discount right now", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW, tickers: [ticker({ venues: [venue({ gapPct: 0 })] })] });

    const plan = await planRuleForAutopilot(bsc, { type: "buy_discount", symbol: "NVDA", discountPct: 2 }, { nowMs: NOW, budgetUsd: 25 });

    expect(plan).toEqual({ ok: true, intents: [], receipt: expect.stringContaining("nothing to do") });
  });

  it("skips with a plain reason when the symbol isn't in today's catalog at all", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({ asOf: NOW, tickers: [] });

    const plan = await planRuleForAutopilot(bsc, { type: "buy_discount", symbol: "NVDA", discountPct: 2 }, { nowMs: NOW, budgetUsd: 25 });

    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("NVDA") });
  });

  it("refuses (rather than buy the wrong issuer) when the twin is discounted but NVDA's own bStock venue isn't", async () => {
    // NVDA's default platform on BSC is bstock (see chains/bsc.assets.ts); ondo is its twin.
    // bStock sits at par (no discount) while Ondo is genuinely 3% cheap. The old `bestVenue`
    // pick (smallest |gap| among buyable venues) would have chosen bStock's ~0% gap and found
    // nothing; classifySpread across every venue correctly finds Ondo's discount instead — but
    // the shared executor pipeline can only buy NVDA's own (bStock) address, so this must refuse
    // rather than sign a buy of the wrong token (review finding #2).
    bscCatalogSnapshotSpy.mockResolvedValue({
      asOf: NOW,
      tickers: [
        ticker({
          venues: [
            venue({ platform: "bstock", gapPct: 0 }),
            venue({ platform: "ondo", symbol: "NVDAon", address: "0xa9ee28c80f960b889dfbd1902055218cba016f75", gapPct: -3 }),
          ],
        }),
      ],
    });

    const plan = await planRuleForAutopilot(bsc, { type: "buy_discount", symbol: "NVDA", discountPct: 2 }, { nowMs: NOW, budgetUsd: 25 });

    expect(plan).toEqual({ ok: false, reason: expect.stringMatching(/other issuer/i) });
  });

  it("does nothing when the only venue with a big enough gap is paused (not buyable)", async () => {
    bscCatalogSnapshotSpy.mockResolvedValue({
      asOf: NOW,
      tickers: [ticker({ venues: [venue({ gapPct: -8, buyable: false, state: "paused" })] })],
    });

    const plan = await planRuleForAutopilot(bsc, { type: "buy_discount", symbol: "NVDA", discountPct: 2 }, { nowMs: NOW, budgetUsd: 25 });

    expect(plan).toEqual({ ok: true, intents: [], receipt: expect.stringContaining("nothing to do") });
  });
});

describe("planRuleForAutopilot: rebalance", () => {
  const rule = { type: "rebalance" as const, driftPct: 10 };

  it("skips honestly when no holdings were supplied", async () => {
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 50, targets: [{ symbol: "NVDA", weightPct: 100 }] });
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("holdings") });
  });

  it("skips honestly when there's no target basket to rebalance against", async () => {
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 50, holdings: [{ symbol: "NVDA", usdValue: 100, tier: "stock" }] });
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("basket") });
  });

  it("buys the underweight name with new cash and a receipt naming the basket — never sells the overweight one (the BSC executor can't sell)", async () => {
    const plan = await planRuleForAutopilot(bsc, rule, {
      nowMs: NOW,
      budgetUsd: 1000,
      holdings: [
        { symbol: "NVDA", usdValue: 75, tier: "stock" },
        { symbol: "AMD", usdValue: 25, tier: "stock" },
      ],
      targets: [
        { symbol: "NVDA", weightPct: 60 },
        { symbol: "AMD", weightPct: 40 },
      ],
      basketName: "AI chips basket",
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.intents.every((i) => i.action === "buy")).toBe(true);
      expect(plan.intents).toEqual([{ symbol: "AMD", action: "buy", usd: 15, reason: expect.stringContaining("AMD") }]);
      expect(plan.receipt).toBe("Vera rebalanced your AI chips basket: bought $15 of AMD.");
    }
  });

  it("caps the buy at the period's real budget, never at the (unfundable) sell side", async () => {
    // NVDA is 90% overweight (would "fund" a $40 move if it could sell); the real cash budget is
    // only $10, so the buy must be capped there, not at whatever the overweight side could sell.
    const plan = await planRuleForAutopilot(bsc, rule, {
      nowMs: NOW,
      budgetUsd: 10,
      holdings: [
        { symbol: "NVDA", usdValue: 90, tier: "stock" },
        { symbol: "AMD", usdValue: 10, tier: "stock" },
      ],
      targets: [
        { symbol: "NVDA", weightPct: 50 },
        { symbol: "AMD", weightPct: 50 },
      ],
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.intents).toEqual([{ symbol: "AMD", action: "buy", usd: 10, reason: expect.any(String) }]);
    }
  });
});

describe("planRuleForAutopilot: safety_switch", () => {
  const rule = { type: "safety_switch" as const, dropPct: 5, movePct: 50 };

  function spyHistory(points: { t: number; referencePrice: number }[]) {
    getSpreadHistorySpy.mockResolvedValue([
      { platform: "bstock", points: points.map((p) => ({ ...p, tokenPrice: p.referencePrice, gapPct: 0, buyable: true, state: "open" })) },
    ]);
  }

  it("skips honestly when no holdings were supplied", async () => {
    spyHistory([{ t: NOW - DAY, referencePrice: 500 }, { t: NOW, referencePrice: 400 }]);
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 100 });
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("holdings") });
  });

  it("skips honestly when the market's move can't be read yet (no history)", async () => {
    getSpreadHistorySpy.mockResolvedValue([]);
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 100, holdings: [{ symbol: "NVDA", usdValue: 100, tier: "stock" }] });
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("market") });
  });

  it("does nothing (ok, empty) when the drop hasn't cleared the threshold", async () => {
    spyHistory([{ t: NOW - DAY, referencePrice: 500 }, { t: NOW, referencePrice: 490 }]); // -2%
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 100, holdings: [{ symbol: "NVDA", usdValue: 100, tier: "stock" }] });
    expect(plan).toEqual({ ok: true, intents: [], receipt: expect.stringContaining("nothing to do") });
  });

  it("buys into the safer list with new cash once SPY's reference price has dropped past the threshold — never sells the at-risk holding (the BSC executor can't sell)", async () => {
    spyHistory([{ t: NOW - DAY, referencePrice: 500 }, { t: NOW, referencePrice: 460 }]); // -8%
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 1000, holdings: [{ symbol: "NVDA", usdValue: 100, tier: "stock" }] });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.intents.every((i) => i.action === "buy")).toBe(true);
      expect(plan.intents.some((i) => i.symbol === "NVDA")).toBe(false);
      expect(plan.intents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ symbol: "SPY", action: "buy", usd: 25 }),
          expect.objectContaining({ symbol: "QQQ", action: "buy", usd: 25 }),
        ]),
      );
    }
  });

  it("caps the safety buy at the period's real budget", async () => {
    spyHistory([{ t: NOW - DAY, referencePrice: 500 }, { t: NOW, referencePrice: 460 }]); // -8%, wants to move $50
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 10, holdings: [{ symbol: "NVDA", usdValue: 100, tier: "stock" }] });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      const total = plan.intents.reduce((s, i) => s + i.usd, 0);
      expect(total).toBeCloseTo(10, 5);
    }
  });
});

describe("planRuleForAutopilot: mix_keeper", () => {
  it("skips honestly when no holdings were supplied", async () => {
    const plan = await planRuleForAutopilot(bsc, { type: "mix_keeper", stockPct: 80 }, { nowMs: NOW, budgetUsd: 100 });
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("holdings") });
  });

  it("buys the underweight side with new cash to keep the mix — never sells the overweight side (the BSC executor can't sell)", async () => {
    const plan = await planRuleForAutopilot(bsc, { type: "mix_keeper", stockPct: 80 }, {
      nowMs: NOW,
      budgetUsd: 1000,
      holdings: [
        { symbol: "NVDA", usdValue: 60, tier: "stock" },
        { symbol: "BTCB", usdValue: 40, tier: "crypto" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.intents).toEqual([{ symbol: "NVDA", action: "buy", usd: 20, reason: expect.any(String) }]);
    }
  });

  it("caps the mix-keeping buy at the period's real budget", async () => {
    const plan = await planRuleForAutopilot(bsc, { type: "mix_keeper", stockPct: 80 }, {
      nowMs: NOW,
      budgetUsd: 5, // wants to move $20
      holdings: [
        { symbol: "NVDA", usdValue: 60, tier: "stock" },
        { symbol: "BTCB", usdValue: 40, tier: "crypto" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.intents).toEqual([{ symbol: "NVDA", action: "buy", usd: 5, reason: expect.any(String) }]);
  });
});

describe("planRuleForAutopilot: earnings", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const rule = { type: "earnings" as const, symbol: "NVDA", buyDaysBefore: 3, sellDaysAfter: 1 };
  const withDate = (nextMs: number | null) =>
    getNextEarningsSpy.mockResolvedValue({ NVDA: { nextMs, confirmed: true, source: "yahoo" } });

  it("never guesses: no announced date means no trade", async () => {
    withDate(null);
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 25, holdings: [] });
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("hasn't announced") });
  });

  it("buys inside the window before results, up to the period budget", async () => {
    withDate(NOW + 2 * DAY);
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 25, holdings: [] });
    expect(plan.ok && plan.intents).toEqual([{ symbol: "NVDA", action: "buy", usd: 25, reason: expect.any(String) }]);
  });

  it("does nothing before the window opens", async () => {
    withDate(NOW + 10 * DAY);
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 25, holdings: [] });
    expect(plan.ok && plan.intents).toEqual([]);
  });

  it("doesn't buy again once the position is held", async () => {
    withDate(NOW + 2 * DAY);
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 25, holdings: [{ symbol: "NVDA", usdValue: 30, tier: "stock" }] });
    expect(plan.ok && plan.intents).toEqual([]);
  });

  it("says plainly that it can't sell after results yet", async () => {
    withDate(NOW - 12 * 60 * 60 * 1000);
    const plan = await planRuleForAutopilot(bsc, rule, { nowMs: NOW, budgetUsd: 25, holdings: [] });
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("can't sell yet") });
  });
});
