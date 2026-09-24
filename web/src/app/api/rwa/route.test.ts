// GET /api/rwa's chain guard: BSC is the only chain with an RWA catalog, so anything else must
// be a plain 400 before the request ever reaches Binance or the cache (Amendment B/C — there is
// no test for this at all otherwise). Rate limiting falls back to an in-process fixed window
// with no Redis configured in this environment, so a unique IP per test needs no extra setup.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

function reqFor(chain: string | null, ip: string): NextRequest {
  const url = chain === null ? "http://localhost/api/rwa" : `http://localhost/api/rwa?chain=${chain}`;
  return new NextRequest(url, { headers: { "x-forwarded-for": ip } });
}

describe("GET /api/rwa", () => {
  it("rejects a chain other than bsc with 400", async () => {
    const res = await GET(reqFor("base", "203.0.113.10"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bsc/i);
  });

  it("rejects a missing chain param with 400 rather than defaulting to one", async () => {
    const res = await GET(reqFor(null, "203.0.113.11"));
    expect(res.status).toBe(400);
  });
});
