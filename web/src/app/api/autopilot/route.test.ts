// POST /api/autopilot's rule guards (review findings #3 and #5): a rule other than
// "buy on a schedule" is BSC-only, a raw `goal` can't fake the encoding only this route should
// ever produce, and RULES_NEEDING_HOLDINGS (still checked here, now empty) would refuse any rule
// type that named itself there. Auth, rate-limit and storage are mocked out so this exercises
// only the POST handler's own checks.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/server/privyAuth", () => ({ verifyRequest: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/server/admin", () => ({ requireApproved: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/server/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/server/users", () => ({ touchUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/server/basketsStore", () => ({ getOwnedBasket: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/server/autopilotPlan", () => ({ resolveAutopilotBasket: vi.fn() }));

const getAutopilotSpy = vi.fn().mockResolvedValue(null);
const upsertAutopilotSpy = vi.fn().mockImplementation((cfg: unknown) => Promise.resolve(cfg));
vi.mock("@/lib/server/autopilotStore", () => ({
  getAutopilot: (...args: unknown[]) => getAutopilotSpy(...args),
  upsertAutopilot: (...args: unknown[]) => upsertAutopilotSpy(...args),
  deleteAutopilot: vi.fn(),
}));

import { POST } from "./route";

function body(overrides: Record<string, unknown> = {}) {
  return {
    walletId: "w1",
    owner: "0x1111111111111111111111111111111111111111",
    smartAccount: "0x2222222222222222222222222222222222222222",
    chain: "bsc",
    goal: "Grow my long-term plan",
    amountUsd: 25,
    cadence: "weekly",
    ...overrides,
  };
}

function req(b: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/autopilot", {
    method: "POST",
    body: JSON.stringify(b),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  getAutopilotSpy.mockReset().mockResolvedValue(null);
  upsertAutopilotSpy.mockReset().mockImplementation((cfg: unknown) => Promise.resolve(cfg));
});

describe("POST /api/autopilot: rules are BSC-only", () => {
  it("refuses a non-schedule rule on Base, even though Base is already deployed", async () => {
    const res = await POST(req(body({ chain: "base", rule: { type: "rebalance", driftPct: 10 } })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/BNB Chain/i);
    expect(upsertAutopilotSpy).not.toHaveBeenCalled();
  });

  it("still allows a plain schedule_buy rule off BSC (unchanged Base/Mantle behaviour)", async () => {
    const res = await POST(req(body({ chain: "base", rule: { type: "schedule_buy" } })));
    expect(res.status).toBe(200);
    expect(upsertAutopilotSpy).toHaveBeenCalled();
  });
});

describe("POST /api/autopilot: a goal can't fake the rule encoding", () => {
  it("refuses a plain goal that already looks like an encoded rule", async () => {
    const res = await POST(req(body({ goal: 'stax:rule:v1:{"type":"buy_discount","symbol":"NVDA","discountPct":2}::x' })));
    expect(res.status).toBe(400);
    expect(upsertAutopilotSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/autopilot: rules that read live holdings (rebalance, safety_switch, mix_keeper)", () => {
  it.each(["rebalance", "safety_switch", "mix_keeper", "buy_discount"] as const)(
    "allows saving a %s rule — RULES_NEEDING_HOLDINGS is empty now that bscHoldings.ts is wired up",
    async (type) => {
      const ruleByType: Record<string, Record<string, unknown>> = {
        rebalance: { type: "rebalance", driftPct: 10 },
        safety_switch: { type: "safety_switch", dropPct: 5, movePct: 50 },
        mix_keeper: { type: "mix_keeper", stockPct: 80 },
        buy_discount: { type: "buy_discount", symbol: "NVDA", discountPct: 2 },
      };
      const res = await POST(req(body({ rule: ruleByType[type] })));
      expect(res.status).toBe(200);
      expect(upsertAutopilotSpy).toHaveBeenCalled();
    },
  );
});
