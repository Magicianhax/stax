// The mapping Review Focus #1/#3 pinned: buildAllocation's typed BSC refusals (market closed,
// under Binance's $6 minimum) must reach the client as a 4xx they can show, not the generic
// "Something went wrong" 500 serverError() gives every unhandled throw. Auth/rate-limit are
// mocked out so this exercises only the POST handler's own error mapping.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/server/privyAuth", () => ({ verifyRequest: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/server/admin", () => ({ requireApproved: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/server/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue({ ok: true }) }));

const buildAllocationSpy = vi.fn();
vi.mock("@/lib/server/allocate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/allocate")>("@/lib/server/allocate");
  return { ...actual, buildAllocation: (...args: unknown[]) => buildAllocationSpy(...args) };
});

import { AllocationRefusal } from "@/lib/server/allocate";
import { POST } from "./route";

function req(): NextRequest {
  return new NextRequest("http://localhost/api/allocate?chain=bsc", {
    method: "POST",
    body: JSON.stringify({ goal: "grow it", amountUsd: 5, riskTolerance: undefined }),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.20" },
  });
}

beforeEach(() => {
  buildAllocationSpy.mockReset();
});

describe("POST /api/allocate error mapping", () => {
  it("maps an AllocationRefusal to a 400 the client can show verbatim", async () => {
    buildAllocationSpy.mockRejectedValue(new AllocationRefusal("$5 is below Binance's $6 minimum per stock."));

    const res = await POST(req());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("$5 is below Binance's $6 minimum per stock.");
  });

  it("still maps an unexpected error to the generic 500, never leaking its message", async () => {
    buildAllocationSpy.mockRejectedValue(new Error("ANTHROPIC_API_KEY invalid"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/ANTHROPIC_API_KEY/);
  });
});
