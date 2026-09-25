// The signed core every Binance Web3 call goes through: the pre-hash that Binance verifies
// byte for byte (docs/BINANCE-WEB3.md §1), the business-error-under-HTTP-200 envelope, and the
// rate-limit backoff that keeps a 429 mid-basket from surfacing as a half-executed leg.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

describe("signRequest", () => {
  it("signs timestamp + METHOD + /build path + body, base64 HMAC-SHA256", async () => {
    const { signRequest } = await import("./client");
    const ts = "2026-09-24T12:26:37.000Z";
    const path = "/build/api/v1/dex/aggregator/supported/chain";
    const expected = createHmac("sha256", "s3cret").update(ts + "GET" + path + "", "utf8").digest("base64");
    expect(signRequest("s3cret", ts, "GET", path, "")).toBe(expected);
  });
});

describe("web3Request", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubFetch(responses: { status: number; json: unknown; headers?: Record<string, string> }[]) {
    const fetchMock = vi.fn();
    for (const r of responses) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(r.json), { status: r.status, headers: r.headers }));
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends the /build prefix and signs the exact query string it sends", async () => {
    vi.stubEnv("WEB3_API_KEY", "k");
    vi.stubEnv("WEB3_SECRET_KEY", "s");
    const fetchMock = stubFetch([{ status: 200, json: { code: 0, msg: "success", data: [] } }]);
    const { web3Request } = await import("./client");
    await web3Request("GET", "/api/v1/dex/market/rwa/tokens", { binanceChainId: "56" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://web3.binance.com/build/api/v1/dex/market/rwa/tokens?binanceChainId=56");
    expect(init.headers["X-OC-APIKEY"]).toBe("k");
    expect(init.headers["X-OC-RECV-WINDOW"]).toBe("60000");
  });

  it("throws on a business error even though the HTTP status is 200", async () => {
    vi.stubEnv("WEB3_API_KEY", "k");
    vi.stubEnv("WEB3_SECRET_KEY", "s");
    stubFetch([{ status: 200, json: { code: 40375, msg: "Minimum order amount is 5 USD.", data: null } }]);
    const { web3Request } = await import("./client");
    await expect(web3Request("GET", "/api/v1/dex/aggregator/quote")).rejects.toMatchObject({ code: 40375 });
  });

  it("backs off and retries on 429, then succeeds", async () => {
    vi.stubEnv("WEB3_API_KEY", "k");
    vi.stubEnv("WEB3_SECRET_KEY", "s");
    stubFetch([
      { status: 429, json: { code: 429, msg: "Too many requests", data: null } },
      { status: 200, json: { code: 0, msg: "success", data: { ok: true } } },
    ]);
    const { web3Request } = await import("./client");
    await expect(web3Request("GET", "/x", {}, undefined)).resolves.toEqual({ ok: true });
  });

  it("never puts the key or the secret in an error message", async () => {
    vi.stubEnv("WEB3_API_KEY", "KEY_SENTINEL");
    vi.stubEnv("WEB3_SECRET_KEY", "SECRET_SENTINEL");
    stubFetch([{ status: 401, json: { code: 40102, msg: "Invalid signature", data: "" } }]);
    const { web3Request } = await import("./client");
    const err = (await web3Request("GET", "/x").catch((e: unknown) => e)) as Error;
    expect(String(err.message)).not.toMatch(/KEY_SENTINEL|SECRET_SENTINEL/);
  });

  it("re-signs with a fresh timestamp on a retried attempt, not the one built before the queue wait", async () => {
    vi.stubEnv("WEB3_API_KEY", "k");
    vi.stubEnv("WEB3_SECRET_KEY", "s");
    const fetchMock = stubFetch([
      { status: 429, json: { code: 429, msg: "Too many requests", data: null } },
      { status: 200, json: { code: 0, msg: "success", data: { ok: true } } },
    ]);
    const { web3Request } = await import("./client");
    await web3Request("GET", "/x");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstTimestamp = fetchMock.mock.calls[0][1].headers["X-OC-TIMESTAMP"];
    const retryTimestamp = fetchMock.mock.calls[1][1].headers["X-OC-TIMESTAMP"];
    // The retry runs after the rate limiter's backoff sleep, so a timestamp built once before
    // the queue and reused on every attempt would go stale past X-OC-RECV-WINDOW; each attempt
    // must carry its own signature and its own timestamp taken when it is actually sent.
    expect(retryTimestamp).not.toBe(firstTimestamp);
    const retrySign = fetchMock.mock.calls[1][1].headers["X-OC-SIGN"];
    const firstSign = fetchMock.mock.calls[0][1].headers["X-OC-SIGN"];
    expect(retrySign).not.toBe(firstSign);
  });

  it("sends every call with an abort signal, so a hung upstream response cannot wedge the queue", async () => {
    vi.stubEnv("WEB3_API_KEY", "k");
    vi.stubEnv("WEB3_SECRET_KEY", "s");
    const fetchMock = stubFetch([{ status: 200, json: { code: 0, msg: "success", data: {} } }]);
    const { web3Request } = await import("./client");
    await web3Request("GET", "/x");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns an aborted (timed-out) request into a BinanceWeb3Error instead of an unhandled rejection", async () => {
    vi.stubEnv("WEB3_API_KEY", "k");
    vi.stubEnv("WEB3_SECRET_KEY", "s");
    const fetchMock = vi.fn().mockRejectedValueOnce(new DOMException("This operation was aborted", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    const { web3Request } = await import("./client");
    await expect(web3Request("GET", "/x")).rejects.toMatchObject({ name: "BinanceWeb3Error" });
  });
});
