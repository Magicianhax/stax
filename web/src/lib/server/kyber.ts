import "server-only";

// KyberSwap Aggregator client (server-only) — the swap venue on Base.
//
//   kyberRoute(chain, { tokenIn, tokenOut, amountIn })  -> best route + expected out, or null
//   kyberBuild(chain, { routeSummary, sender, recipient, slippageBps, deadline }) -> calldata
//
// Flow: GET /routes finds the best path across Aerodrome / Aerodrome CL / Uniswap v3+v4;
// POST /route/build turns that routeSummary into MetaAggregationRouterV2 calldata. Routes are
// only valid for ~10s, so callers build immediately before sending. The router pulls
// `amountIn` from `sender` via ERC-20 allowance and delivers the output to `recipient`.
//
// Safety: the returned routerAddress MUST equal `chain.routers.kyber` (the only Kyber router
// the executor whitelists); anything else is rejected before a byte of calldata is used.
// Stax's platform fee stays the existing treasury transfer — Kyber's `extraFee` is never set.
// Kyber does not support Mantle; callers only reach this module on chains with `routers.kyber`.
import type { StaxChain } from "@/lib/chains/types";

const API_BASE = "https://aggregator-api.kyberswap.com";
const TIMEOUT_MS = 8_000;
/** Whitelisted partner id (rate-limit tier) — server-only, never sent to the browser. */
const CLIENT_ID = process.env.KYBER_CLIENT_ID || "monvera";
/** Recorded on-chain in the router's ClientData event. */
const SOURCE = "monvera";
/** Kyber's chain slug per Stax chain key. Absent ⇒ Kyber does not serve that chain. */
const CHAIN_SLUG: Partial<Record<StaxChain["key"], string>> = { base: "base" };

/** Kyber could not find a path (code 4008/4010) — a business outcome, not a failure. */
export class KyberNoRoute extends Error {
  constructor(message = "No swap route found.") {
    super(message);
    this.name = "KyberNoRoute";
  }
}

/** Any other upstream problem: network, timeout, non-zero code, malformed payload. */
export class KyberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KyberError";
  }
}

/** Opaque route summary — passed back to /route/build verbatim (checksummed by Kyber). */
export type KyberRouteSummary = Record<string, unknown> & {
  tokenIn: string;
  amountIn: string;
  tokenOut: string;
  amountOut: string;
};

export interface KyberRouteResult {
  routeSummary: KyberRouteSummary;
  routerAddress: `0x${string}`;
  /** Expected tokenOut (raw units) before slippage. */
  amountOut: bigint;
}

export interface KyberBuildResult {
  /** Calldata for `router` (MetaAggregationRouterV2.swap). */
  data: `0x${string}`;
  router: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
}

interface KyberEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

function slugOf(chain: StaxChain): string {
  const slug = CHAIN_SLUG[chain.key];
  if (!slug || !chain.routers.kyber) throw new KyberError(`KyberSwap is not available on ${chain.name}.`);
  return slug;
}

/** Fetch + decode a Kyber envelope. Maps "route not found" to KyberNoRoute, all else to KyberError. */
async function call<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { accept: "application/json", "x-client-id": CLIENT_ID, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    throw new KyberError(timeout ? "KyberSwap timed out." : "KyberSwap is unreachable.");
  }
  let json: KyberEnvelope<T>;
  try {
    json = (await res.json()) as KyberEnvelope<T>;
  } catch {
    throw new KyberError(`KyberSwap returned a malformed response (HTTP ${res.status}).`);
  }
  if (json.code === 4008 || json.code === 4010 || /route not found/i.test(json.message ?? "")) {
    throw new KyberNoRoute();
  }
  if (!res.ok || json.code !== 0 || !json.data) {
    throw new KyberError(`KyberSwap error ${json.code ?? res.status}: ${json.message ?? "unknown"}.`);
  }
  return json.data;
}

function assertWhitelistedRouter(chain: StaxChain, routerAddress: unknown): `0x${string}` {
  const expected = chain.routers.kyber!;
  if (typeof routerAddress !== "string" || routerAddress.toLowerCase() !== expected.toLowerCase()) {
    // Never call a router the executor hasn't whitelisted (and the user's approve would target).
    throw new KyberError("KyberSwap returned an unexpected router address.");
  }
  return expected;
}

function toBigInt(v: unknown, field: string): bigint {
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw new KyberError(`KyberSwap response is missing ${field}.`);
  return BigInt(v);
}

/**
 * Best route for `amountIn` (raw) of `tokenIn` into `tokenOut`. Returns null when Kyber has
 * no path (e.g. a stock that isn't minted yet). Throws KyberError on upstream failure.
 */
/**
 * Private market makers quote off-chain: the price is signed, short-lived and
 * usually single-use. That is fine for a swap that is signed and sent in the
 * same breath, and wrong for a plan, which is built, reviewed, held to confirm,
 * then bundled — by the time it lands the quote can be gone, and the whole
 * invest reverts with its gas spent. One of ours did, on a Bitcoin leg routed
 * through `pmm-8`.
 *
 * So: look at the route we were given, and if any hop is a PMM, ask again with
 * those sources excluded. Costs a second request only when a PMM appears, and
 * an AMM route survives the wait.
 */
function pmmSourcesIn(summary: KyberRouteSummary): string[] {
  const route = summary.route;
  if (!Array.isArray(route)) return [];
  const found = new Set<string>();
  for (const hop of route.flat() as { exchange?: unknown }[]) {
    const ex = typeof hop?.exchange === "string" ? hop.exchange : "";
    if (ex.toLowerCase().startsWith("pmm")) found.add(ex);
  }
  return [...found];
}

export async function kyberRoute(
  chain: StaxChain,
  args: { tokenIn: `0x${string}`; tokenOut: `0x${string}`; amountIn: bigint; excludeSources?: string[] },
): Promise<KyberRouteResult | null> {
  const slug = slugOf(chain);
  const q = new URLSearchParams({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn.toString(),
  });
  if (args.excludeSources?.length) q.set("excludedSources", args.excludeSources.join(","));
  try {
    const data = await call<{ routeSummary?: KyberRouteSummary; routerAddress?: string }>(
      `${API_BASE}/${slug}/api/v1/routes?${q}`,
      { method: "GET" },
    );
    if (!data.routeSummary) throw new KyberError("KyberSwap response is missing routeSummary.");
    const routerAddress = assertWhitelistedRouter(chain, data.routerAddress);
    const amountOut = toBigInt(data.routeSummary.amountOut, "amountOut");
    if (amountOut <= BigInt(0)) return null;

    // Second pass only when the first route leaned on a market maker.
    const pmm = args.excludeSources?.length ? [] : pmmSourcesIn(data.routeSummary);
    if (pmm.length) {
      const amm = await kyberRoute(chain, { ...args, excludeSources: pmm });
      if (amm) return amm;
      // No AMM-only route: better a perishable quote than no route at all.
      console.warn(`[kyber] only a PMM route for ${args.tokenOut} (${pmm.join(",")})`);
    }
    return { routeSummary: data.routeSummary, routerAddress, amountOut };
  } catch (e) {
    if (e instanceof KyberNoRoute) return null;
    throw e;
  }
}

/**
 * Encode `routeSummary` into router calldata. `sender` must hold + approve `amountIn` to the
 * router; the output lands on `recipient`. `slippageBps` is Kyber's own minReturn guard
 * (0–2000); `deadline` is unix seconds.
 */
export async function kyberBuild(
  chain: StaxChain,
  args: {
    routeSummary: KyberRouteSummary;
    sender: `0x${string}`;
    recipient: `0x${string}`;
    slippageBps: number;
    deadline: number;
  },
): Promise<KyberBuildResult> {
  const slug = slugOf(chain);
  const slippageTolerance = Math.max(0, Math.min(2000, Math.round(args.slippageBps)));
  const data = await call<{ data?: string; routerAddress?: string; amountIn?: string; amountOut?: string }>(
    `${API_BASE}/${slug}/api/v1/route/build`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        routeSummary: args.routeSummary,
        sender: args.sender,
        recipient: args.recipient,
        slippageTolerance,
        deadline: Math.floor(args.deadline),
        source: SOURCE,
        enableGasEstimation: false,
      }),
    },
  );
  const router = assertWhitelistedRouter(chain, data.routerAddress);
  if (typeof data.data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(data.data)) {
    throw new KyberError("KyberSwap returned empty calldata.");
  }
  return {
    data: data.data as `0x${string}`,
    router,
    amountIn: toBigInt(data.amountIn, "amountIn"),
    amountOut: toBigInt(data.amountOut, "amountOut"),
  };
}
