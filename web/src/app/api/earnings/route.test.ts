// GET /api/earnings's chain guard and shape, mirroring /api/rwa/route.test.ts's pattern (BSC is
// the only chain with an earnings calendar). getNextEarnings itself is unit-tested in
// lib/server/earnings.test.ts against stubbed fetches; here it's mocked so this file only pins
// the route's own behavior — the guard, the rate limit, and the response shape.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/server/earnings", () => ({ getNextEarnings: vi.fn().mockResolvedValue({ NVDA: { nextMs: null, confirmed: false, source: "unavailable" } }) }));

import { GET } from "./route";

function reqFor(chain: string | null, ip: string): NextRequest {
  const url = chain === null ? "http://localhost/api/earnings" : `http://localhost/api/earnings?chain=${chain}`;
  return new NextRequest(url, { headers: { "x-forwarded-for": ip } });
}

describe("GET /api/earnings", () => {
  it("rejects a chain other than bsc with 400", async () => {
    const res = await GET(reqFor("base", "203.0.113.20"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bsc/i);
  });

  it("rejects a missing chain param with 400 rather than defaulting to one", async () => {
    const res = await GET(reqFor(null, "203.0.113.21"));
    expect(res.status).toBe(400);
  });

  it("returns the earnings map and an asOf timestamp for bsc", async () => {
    const res = await GET(reqFor("bsc", "203.0.113.22"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.earnings.NVDA).toEqual({ nextMs: null, confirmed: false, source: "unavailable" });
    expect(typeof body.asOf).toBe("number");
  });
});
