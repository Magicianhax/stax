// GET /api/rwa/spread/[ticker]'s guards: BSC-only, and an unknown ticker is a 404 before any
// Redis read. A known ticker with nothing recorded yet returns an honest empty `venues` array —
// this file never fakes a history point.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

function reqFor(ticker: string, chain: string | null, ip: string): NextRequest {
  const url = chain === null ? `http://localhost/api/rwa/spread/${ticker}` : `http://localhost/api/rwa/spread/${ticker}?chain=${chain}`;
  return new NextRequest(url, { headers: { "x-forwarded-for": ip } });
}

function ctx(ticker: string) {
  return { params: Promise.resolve({ ticker }) };
}

describe("GET /api/rwa/spread/[ticker]", () => {
  it("rejects a chain other than bsc with 400", async () => {
    const res = await GET(reqFor("NVDA", "base", "203.0.113.30"), ctx("NVDA"));
    expect(res.status).toBe(400);
  });

  it("404s an unknown ticker", async () => {
    const res = await GET(reqFor("NOTATICKER", "bsc", "203.0.113.31"), ctx("NOTATICKER"));
    expect(res.status).toBe(404);
  });

  it("200s a known ticker with an empty venues array when nothing has been recorded", async () => {
    const res = await GET(reqFor("nvda", "bsc", "203.0.113.32"), ctx("nvda"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticker).toBe("NVDA");
    expect(Array.isArray(body.venues)).toBe(true);
  });
});
