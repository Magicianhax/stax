// spreadStore: folding one new snapshot into a ticker+issuer's kept history (trim by age,
// collapse anything inside the spacing window instead of piling up), and the record/read round
// trip. No Redis credentials are set in this test environment, so getRedis() resolves to null
// and every call below exercises the per-process memory fallback — the same path production
// takes whenever UPSTASH_REDIS_REST_* / KV_REST_API_* aren't configured (cache.ts, rateLimit.ts
// degrade the same way). Each test uses its own ticker/platform key so the module-level memory
// Map can't leak state between tests.
import { describe, expect, it } from "vitest";
import { SPREAD_HISTORY_DAYS, SPREAD_SNAPSHOT_SPACING_MINUTES, type SpreadPoint } from "@/lib/spread";
import { claimSpreadTick, foldSpreadPoint, getSpreadHistory, recordCatalogSnapshot, recordSpreadPoint } from "./spreadStore";

const DAY_MS = 24 * 60 * 60 * 1000;
const SPACING_MS = SPREAD_SNAPSHOT_SPACING_MINUTES * 60 * 1000;

function point(t: number, over: Partial<SpreadPoint> = {}): SpreadPoint {
  return { t, tokenPrice: 100, referencePrice: 100, gapPct: 0, buyable: true, state: "open", ...over };
}

describe("foldSpreadPoint", () => {
  it("appends a point that lands after the spacing window", () => {
    const existing = [point(0)];
    const next = point(SPACING_MS + 1000);
    expect(foldSpreadPoint(existing, next)).toEqual([existing[0], next]);
  });

  it("replaces the last point instead of appending when inside the spacing window", () => {
    const existing = [point(0), point(SPACING_MS)];
    const next = point(SPACING_MS + 1000, { tokenPrice: 105 });
    const folded = foldSpreadPoint(existing, next);
    expect(folded).toHaveLength(2);
    expect(folded[1]).toEqual(next);
  });

  it("drops points older than the history window relative to the new point's time", () => {
    const old = point(0);
    const recent = point(SPREAD_HISTORY_DAYS * DAY_MS - SPACING_MS);
    const next = point(SPREAD_HISTORY_DAYS * DAY_MS + SPACING_MS * 2);
    const folded = foldSpreadPoint([old, recent], next);
    expect(folded.find((p) => p.t === old.t)).toBeUndefined();
    expect(folded).toEqual([recent, next]);
  });
});

describe("recordSpreadPoint / getSpreadHistory (memory fallback)", () => {
  it("round-trips a single point", async () => {
    await recordSpreadPoint("bsc", "TEST1", "bstock", point(1_000));
    const history = await getSpreadHistory("bsc", "TEST1", ["bstock", "ondo"]);
    expect(history).toEqual([{ platform: "bstock", points: [point(1_000)] }]);
  });

  it("keeps issuers separate under the same ticker", async () => {
    await recordSpreadPoint("bsc", "TEST2", "bstock", point(1_000, { tokenPrice: 10 }));
    await recordSpreadPoint("bsc", "TEST2", "ondo", point(1_000, { tokenPrice: 11 }));
    const history = await getSpreadHistory("bsc", "TEST2", ["bstock", "ondo"]);
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.platform === "bstock")?.points[0].tokenPrice).toBe(10);
    expect(history.find((h) => h.platform === "ondo")?.points[0].tokenPrice).toBe(11);
  });

  it("leaves out an issuer with no recorded points rather than returning an empty entry", async () => {
    await recordSpreadPoint("bsc", "TEST3", "bstock", point(1_000));
    const history = await getSpreadHistory("bsc", "TEST3", ["bstock", "ondo"]);
    expect(history).toEqual([{ platform: "bstock", points: [point(1_000)] }]);
  });

  it("appends across calls, folding by the same spacing rule", async () => {
    await recordSpreadPoint("bsc", "TEST4", "bstock", point(0));
    await recordSpreadPoint("bsc", "TEST4", "bstock", point(SPACING_MS + 1));
    const history = await getSpreadHistory("bsc", "TEST4", ["bstock"]);
    expect(history[0].points).toHaveLength(2);
  });
});

describe("claimSpreadTick", () => {
  it("claims the first tick in a window and refuses a second one inside it", async () => {
    expect(await claimSpreadTick("bsc-tick-1", 0, SPACING_MS)).toBe(true);
    expect(await claimSpreadTick("bsc-tick-1", SPACING_MS - 1, SPACING_MS)).toBe(false);
  });

  it("allows a new claim once the window has passed", async () => {
    expect(await claimSpreadTick("bsc-tick-2", 0, SPACING_MS)).toBe(true);
    expect(await claimSpreadTick("bsc-tick-2", SPACING_MS, SPACING_MS)).toBe(true);
  });

  it("keeps separate chain keys independent", async () => {
    expect(await claimSpreadTick("bsc-tick-3a", 0, SPACING_MS)).toBe(true);
    expect(await claimSpreadTick("bsc-tick-3b", 0, SPACING_MS)).toBe(true);
  });
});

describe("recordCatalogSnapshot", () => {
  it("records one point per venue across every ticker and reports how many it wrote", async () => {
    const result = await recordCatalogSnapshot(
      "bsc",
      [
        {
          ticker: "TEST5",
          name: "Test Five",
          type: "stock",
          bestVenue: "bstock",
          venues: [
            {
              platform: "bstock",
              symbol: "TEST5B",
              address: "0x0000000000000000000000000000000000000001",
              tokenPrice: 10,
              referencePrice: 10,
              gapPct: 0,
              state: "open",
              buyable: true,
              nextOpenMs: null,
              updatedAt: 5_000,
            },
            {
              platform: "ondo",
              symbol: "TEST5on",
              address: "0x0000000000000000000000000000000000000002",
              tokenPrice: 10.5,
              referencePrice: 10,
              gapPct: 5,
              state: "open",
              buyable: true,
              nextOpenMs: null,
              updatedAt: 5_000,
            },
          ],
        },
      ],
      5_000,
    );
    expect(result).toEqual({ venuesRecorded: 2 });
    const history = await getSpreadHistory("bsc", "TEST5", ["bstock", "ondo"]);
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.platform === "ondo")?.points[0]).toEqual({
      t: 5_000,
      tokenPrice: 10.5,
      referencePrice: 10,
      gapPct: 5,
      buyable: true,
      state: "open",
    });
  });
});
