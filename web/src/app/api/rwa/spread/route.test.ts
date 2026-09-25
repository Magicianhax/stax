// GET /api/rwa/spread's chain guard, mirroring /api/rwa/route.test.ts: the board only exists on
// BSC, so anything else is a plain 400 before the request ever reaches the catalog cache. The
// success-path test mocks the catalog (rather than Binance) so it exercises the route's own
// wiring of classifySpread/cheaperIssuerNow against a fixed snapshot.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RwaTickerView } from "@/lib/rwa";

function reqFor(chain: string | null, ip: string): NextRequest {
  const url = chain === null ? "http://localhost/api/rwa/spread" : `http://localhost/api/rwa/spread?chain=${chain}`;
  return new NextRequest(url, { headers: { "x-forwarded-for": ip } });
}

describe("GET /api/rwa/spread", () => {
  it("rejects a chain other than bsc with 400", async () => {
    const { GET } = await import("./route");
    const res = await GET(reqFor("base", "203.0.113.20"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bsc/i);
  });

  it("rejects a missing chain param with 400 rather than defaulting to one", async () => {
    const { GET } = await import("./route");
    const res = await GET(reqFor(null, "203.0.113.21"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/rwa/spread — success path", () => {
  const NVDA_CLOSED: RwaTickerView = {
    ticker: "NVDA",
    name: "NVIDIA",
    type: "stock",
    bestVenue: null,
    venues: [
      {
        platform: "bstock",
        symbol: "NVDAB",
        address: "0x0000000000000000000000000000000000000001",
        tokenPrice: 102, // 2% over the 100 reference, market shut ⇒ premium
        referencePrice: 100,
        gapPct: 2,
        state: "closed",
        buyable: true,
        nextOpenMs: 1_000,
        updatedAt: 1_000,
      },
      {
        platform: "ondo",
        symbol: "NVDAon",
        address: "0x0000000000000000000000000000000000000002",
        tokenPrice: 100.4,
        referencePrice: 100,
        gapPct: 0.4,
        state: "closed",
        buyable: false,
        nextOpenMs: 1_000,
        updatedAt: 1_000,
      },
    ],
  };
  const AAPL_SINGLE_ISSUER: RwaTickerView = {
    ticker: "AAPL",
    name: "Apple",
    type: "stock",
    bestVenue: "bstock",
    venues: [
      {
        platform: "bstock",
        symbol: "AAPLB",
        address: "0x0000000000000000000000000000000000000003",
        tokenPrice: 200,
        referencePrice: 200,
        gapPct: 0,
        state: "open",
        buyable: true,
        nextOpenMs: null,
        updatedAt: 1_000,
      },
    ],
  };

  async function loadRouteWithFixture() {
    vi.resetModules();
    vi.doMock("@/lib/server/rwaCatalog", () => ({
      bscCatalogSnapshot: async () => ({ tickers: [NVDA_CLOSED, AAPL_SINGLE_ISSUER], asOf: 1_000 }),
    }));
    return import("./route");
  }

  it("labels a closed ticker 2% above the real share as a premium, and ranks the board by the issuer gap", async () => {
    const { GET } = await loadRouteWithFixture();
    const res = await GET(reqFor("bsc", "203.0.113.30"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Board: only dual-listed NVDA has two issuers to compare; single-issuer AAPL has nothing to rank.
    expect(body.board.map((r: { ticker: string }) => r.ticker)).toEqual(["NVDA"]);
    expect(body.board[0].cheaper).toBe("ondo");
    expect(body.board[0].sentence).toMatch(/^Ondo is \$[\d.]+ cheaper \([\d.]+%\)/);

    // Per-ticker calls cover every catalog ticker, including the single-issuer one.
    const nvda = body.tickers.find((t: { ticker: string }) => t.ticker === "NVDA");
    const aapl = body.tickers.find((t: { ticker: string }) => t.ticker === "AAPL");
    expect(nvda).toBeDefined();
    expect(aapl).toBeDefined();

    const bstockCall = nvda.venues.find((v: { platform: string }) => v.platform === "bstock").call;
    expect(bstockCall.label).toBe("premium");
    const ondoCall = nvda.venues.find((v: { platform: string }) => v.platform === "ondo").call;
    expect(ondoCall.label).not.toBe("premium"); // 0.4% is under the threshold

    // "Cheaper issuer right now" (brief idea 3) reaches the API: ondo is cheaper and bstock is
    // the only one buyable, but cheaperIssuerNow only restricts to buyable issuers when at least
    // one is buyable — here that's bstock alone, so it wins despite being pricier.
    expect(nvda.cheaperIssuer).toBe("bstock");
    // Single-issuer ticker: only one candidate, so it's trivially "the one to buy from" — never
    // null, since `cheaperIssuerNow` only returns null with no bStock/Ondo venue at all.
    expect(aapl.cheaperIssuer).toBe("bstock");
  });
});
