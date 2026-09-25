// getNextEarnings / parseYahooEarningsHtml — see the module doc comment for why Yahoo Finance's
// quote-page HTML is the source (docs/BINANCE-WEB3.md has no earnings field; Yahoo's own
// quoteSummary JSON API now 401s "Invalid Crumb" for a keyless caller, confirmed live). Every
// network call is stubbed; nothing here touches the real internet.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getNextEarnings, parseYahooEarningsHtml } from "./earnings";

// A real quote page is ~1MB of React SSR JSON; this is the one escaped fragment the parser
// looks for (verified live against finance.yahoo.com/quote/NVDA/ on 2026-09-25), wrapped in a
// little surrounding noise so the regex is proven to find it inside a bigger document, not just
// match a bare fixture.
function pageWith(rawSeconds: number, fmt: string, isEstimate: boolean): string {
  return (
    '<script>root.App.main = JSON.parse("{\\"context\\":{\\"dispatcher\\":{\\"stores\\":{\\"QuoteSummaryStore\\":{' +
    `\\"calendarEvents\\":{\\"earnings\\":{\\"earningsDate\\":[{\\"raw\\":${rawSeconds},\\"fmt\\":\\"${fmt}\\"}],` +
    `\\"isEarningsDateEstimate\\":${isEstimate}}` +
    '}}}}}}");</script>'
  );
}

const NO_MATCH_PAGE = '<script>root.App.main = JSON.parse("{\\"context\\":{}}");</script>';

describe("parseYahooEarningsHtml", () => {
  it("reads an announced date", () => {
    expect(parseYahooEarningsHtml(pageWith(1794945600, "2026-11-17", false))).toEqual({
      nextMs: 1794945600_000,
      confirmed: true,
    });
  });

  it("reads confirmed=false for Yahoo's own estimate", () => {
    expect(parseYahooEarningsHtml(pageWith(1793217600, "2026-10-28", true))).toEqual({
      nextMs: 1793217600_000,
      confirmed: false,
    });
  });

  it("returns null when the page carries no earnings module at all", () => {
    expect(parseYahooEarningsHtml(NO_MATCH_PAGE)).toBeNull();
  });
});

function fetchReturning(html: string, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({ ok, text: () => Promise.resolve(html) });
}

describe("getNextEarnings", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a symbol to Yahoo's announced date", async () => {
    vi.stubGlobal("fetch", fetchReturning(pageWith(1794945600, "2026-11-17", false)));
    const out = await getNextEarnings(["EARN_A1"]);
    expect(out.EARN_A1).toEqual({ nextMs: 1794945600_000, confirmed: true, source: "yahoo" });
  });

  it("is best-effort: an HTTP error for one symbol gives null, never throws", async () => {
    vi.stubGlobal("fetch", fetchReturning("", false));
    const out = await getNextEarnings(["EARN_A2"]);
    expect(out.EARN_A2).toEqual({ nextMs: null, confirmed: false, source: "unavailable" });
  });

  it("is best-effort: a network failure gives null, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const out = await getNextEarnings(["EARN_A3"]);
    expect(out.EARN_A3).toEqual({ nextMs: null, confirmed: false, source: "unavailable" });
  });

  it("never fetches a known ETF ticker — a fund has no earnings report to look up", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    vi.stubGlobal("fetch", fetchMock);
    const out = await getNextEarnings(["QQQ"]);
    expect(out.QQQ).toEqual({ nextMs: null, confirmed: false, source: "not-applicable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not cache a failed fetch: a later call retries and can return the real date", async () => {
    // Regression for caching UNAVAILABLE at the full 12h TTL: a 429/timeout on the one cold
    // refresh used to freeze "not announced yet" for every reader for 12h even though Yahoo had
    // the date. The fix makes a failure reject instead of resolve, so `cached()` never writes it
    // (cache.ts: "fn rejections are not cached") and the very next call is free to try again.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve("") })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(pageWith(1794945600, "2026-11-17", false)) });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getNextEarnings(["EARN_C1"]);
    expect(first.EARN_C1).toEqual({ nextMs: null, confirmed: false, source: "unavailable" });

    const second = await getNextEarnings(["EARN_C1"]);
    expect(second.EARN_C1).toEqual({ nextMs: 1794945600_000, confirmed: true, source: "yahoo" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves every symbol to its own result, not a shared or shuffled one", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("EARN_B1")) return Promise.resolve({ ok: true, text: () => Promise.resolve(pageWith(1794945600, "2026-11-17", false)) });
      return Promise.resolve({ ok: true, text: () => Promise.resolve(NO_MATCH_PAGE) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await getNextEarnings(["EARN_B1", "EARN_B2"]);
    expect(out.EARN_B1).toEqual({ nextMs: 1794945600_000, confirmed: true, source: "yahoo" });
    expect(out.EARN_B2).toEqual({ nextMs: null, confirmed: false, source: "unavailable" });
  });
});
