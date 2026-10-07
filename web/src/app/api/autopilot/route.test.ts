// POST /api/autopilot's rule guards (review findings #3 and #5): a rule other than
// "buy on a schedule" is BSC-only, a raw `goal` can't fake the encoding only this route should
// ever produce, and RULES_NEEDING_HOLDINGS (still checked here, now empty) would refuse any rule
// type that named itself there. Auth, rate-limit and storage are mocked out so this exercises
// only the POST handler's own checks.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fetchWalletsMock = vi.fn();
vi.mock("@/lib/server/privyAuth", () => ({
  verifyRequest: vi.fn().mockResolvedValue({ userId: "u1" }),
  fetchPrivyEmbeddedWallets: (...args: unknown[]) => fetchWalletsMock(...args),
}));
vi.mock("@/lib/server/admin", () => ({ requireApproved: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/server/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue({ ok: true }) }));
const getSmartAccountMock = vi.fn();
vi.mock("@/lib/server/users", () => ({
  touchUser: vi.fn().mockResolvedValue(undefined),
  getSmartAccount: (...args: unknown[]) => getSmartAccountMock(...args),
}));
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
  // A normal user has registered the smart account body() sends.
  getSmartAccountMock.mockReset().mockResolvedValue({ address: "0x2222222222222222222222222222222222222222" });
  // The caller's own embedded wallet is exactly what body() sends.
  fetchWalletsMock.mockReset().mockResolvedValue([{ id: "w1", address: "0x1111111111111111111111111111111111111111" }]);
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
  it("refuses an Autopilot aimed at someone else's smart account", async () => {
    getSmartAccountMock.mockResolvedValueOnce({ address: "0x3333333333333333333333333333333333333333" });
    const res = await POST(req(body()));
    expect(res.status).toBe(403);
  });

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

describe("POST /api/autopilot: the signing wallet must be the caller's own", () => {
  it("refuses another user's wallet id paired with the caller's own smart account", async () => {
    const res = await POST(req(body({ walletId: "w_victim", owner: "0x9999999999999999999999999999999999999999" })));
    expect(res.status).toBe(403);
    expect(upsertAutopilotSpy).not.toHaveBeenCalled();
  });

  it("fails closed when Privy can't be reached, rather than trusting the body", async () => {
    fetchWalletsMock.mockRejectedValueOnce(new Error("privy down"));
    const res = await POST(req(body()));
    expect(res.status).toBe(503);
    expect(upsertAutopilotSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/autopilot: a registered smart account is required", () => {
  it("returns a plain 409 when the user has no smart account on this chain", async () => {
    getSmartAccountMock.mockResolvedValue(null);
    const res = await POST(req(body()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Open your wallet once/);
    expect(upsertAutopilotSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/autopilot: BNB Chain amounts that could never trade", () => {
  it("refuses the $5 daily idea: under Binance's $6 minimum, every run would be skipped", async () => {
    const res = await POST(req(body({ amountUsd: 5, cadence: "daily" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least \$6/);
    expect(upsertAutopilotSpy).not.toHaveBeenCalled();
  });

  it("needs $12 for a safety switch, which buys two names", async () => {
    const rule = { type: "safety_switch", dropPct: 3, movePct: 25 };
    expect((await POST(req(body({ amountUsd: 10, rule })))).status).toBe(400);
    expect((await POST(req(body({ amountUsd: 12, rule })))).status).toBe(200);
  });

  it("leaves Base's small amounts alone", async () => {
    expect((await POST(req(body({ chain: "base", amountUsd: 5 })))).status).toBe(200);
  });
});
