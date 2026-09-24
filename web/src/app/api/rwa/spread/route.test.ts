// GET /api/rwa/spread's chain guard, mirroring /api/rwa/route.test.ts: the board only exists on
// BSC, so anything else is a plain 400 before the request ever reaches the catalog cache.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

function reqFor(chain: string | null, ip: string): NextRequest {
  const url = chain === null ? "http://localhost/api/rwa/spread" : `http://localhost/api/rwa/spread?chain=${chain}`;
  return new NextRequest(url, { headers: { "x-forwarded-for": ip } });
}

describe("GET /api/rwa/spread", () => {
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
});
