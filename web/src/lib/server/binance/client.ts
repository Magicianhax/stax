import "server-only";

// The signed core of the Binance Web3 API, proven byte for byte against live calls in
// docs/BINANCE-WEB3.md §1. Every module wrapper in this directory goes through `web3Request`;
// nothing else builds a request path or a signature.
import { createHmac } from "node:crypto";
import { limited } from "./rateLimit";
import { BinanceWeb3Error } from "./types";

const ORIGIN = "https://web3.binance.com";
const PREFIX = "/build";

type Query = Record<string, string | number | boolean | undefined>;

/**
 * `preHash = timestamp + METHOD + requestPath + body`, no separators, UTF-8. `requestPath`
 * includes the `/build` prefix and the exact query string that goes on the wire — leaving out
 * `/build` is the documented top cause of a 40102 "Invalid signature". Exported as a pure
 * function so it can be pinned by a test independent of env vars or fetch.
 */
export function signRequest(secret: string, timestamp: string, method: string, requestPath: string, body: string): string {
  return createHmac("sha256", secret).update(timestamp + method + requestPath + body, "utf8").digest("base64");
}

/** Every call gets this long on the wire before it counts as hung; see docs/BINANCE-WEB3.md's
 * recorded slow-upstream failure (50000 after 4.2s). One process-wide queue means one hung
 * response would otherwise stall every quote, catalog read and basket leg behind it. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Signs and sends one Binance Web3 call. Env vars are read here, not at module load, so a
 * request always uses whatever WEB3_API_KEY/WEB3_SECRET_KEY are current — real ones in
 * production, stubbed ones in a test. Every fetch goes through `limited()` so a basket of legs
 * never outruns the 5-per-window budget and a 429 backs off in place instead of surfacing as a
 * half-executed leg. The timestamp and signature are built inside the closure `limited()` calls,
 * not before it, so a retry that only runs once the queue and the backoff sleep are done is
 * signed for the moment it actually goes out — a timestamp taken up front would still be the one
 * replayed on a second or third attempt, and by then it can already be past the recv window.
 */
export async function web3Request<T>(
  method: "GET" | "POST",
  path: string,
  query: Query = {},
  body?: unknown,
): Promise<T> {
  const apiKey = process.env.WEB3_API_KEY;
  const secretKey = process.env.WEB3_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error("WEB3_API_KEY / WEB3_SECRET_KEY are not set");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.append(k, String(v));
  const q = qs.toString();
  const requestPath = `${PREFIX}${path}${q ? `?${q}` : ""}`;
  const bodyStr = body === undefined ? "" : JSON.stringify(body);

  let res: Response;
  try {
    res = await limited(() => {
      const timestamp = new Date().toISOString();
      const sign = signRequest(secretKey, timestamp, method, requestPath, bodyStr);
      return fetch(ORIGIN + requestPath, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-OC-APIKEY": apiKey,
          "X-OC-TIMESTAMP": timestamp,
          "X-OC-SIGN": sign,
          "X-OC-RECV-WINDOW": "60000",
        },
        body: bodyStr || undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new BinanceWeb3Error(-1, `request timed out after ${REQUEST_TIMEOUT_MS}ms`, 0);
    }
    throw err;
  }

  const json = (await res.json()) as { code: number; msg: string; data: T; success?: boolean };
  // Business failures arrive as HTTP 200 with code != 0, and the one signature failure seen
  // live (40102) came back as HTTP 401 with the same envelope, so `code` decides either way —
  // never branch on `res.ok` alone.
  if (json.code !== 0) throw new BinanceWeb3Error(json.code, json.msg, res.status);
  return json.data;
}
