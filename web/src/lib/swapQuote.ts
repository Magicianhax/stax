"use client";

// Client for POST /api/swap-quote — KyberSwap aggregator quotes + calldata on aggregator
// chains (Base). Shared by useQuote (build=false, display) and useSwap (build=true,
// fetched immediately before the UserOp is sent — Kyber routes are good for ~10s).
import { authedFetch } from "@/lib/authedFetch";
import type { Asset, RwaPlatform, StaxChain } from "@/lib/chains";
import type { DryRun } from "@/lib/dryRun";

/** Wire shape of /api/swap-quote (amounts are raw-unit decimal strings). */
export interface SwapQuoteWire {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  amountOut: string;
  minOut: string;
  data?: `0x${string}`;
  expiresAt: number;
  /** BSC only, present only when the request had build=true. See lib/dryRun.ts. */
  dryRun?: DryRun;
}

export interface SwapQuote {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  data?: `0x${string}`;
  expiresAt: number;
  dryRun?: DryRun;
}

export interface SwapQuoteArgs {
  symbol: string;
  side: "buy" | "sell";
  amountIn: bigint;
  sender: `0x${string}`;
  recipient: `0x${string}`;
  slippageBps?: number;
  build?: boolean;
  /** BSC only: which issuer to trade. Ignored (and safe to omit) on every other chain. */
  venue?: RwaPlatform;
}

/** True when `asset` is quoted + swapped through the aggregator on `chain`. */
export function usesAggregator(chain: StaxChain, asset: Asset | null | undefined): boolean {
  if (!asset || !asset.address || asset.via === "aave_v3") return false;
  if (chain.routers.kyber) return true;
  // BSC has no Kyber deployment; every "binance"-via asset routes through the Binance
  // aggregator instead, quoted the same way through /api/swap-quote.
  return Boolean(chain.routers.binance && asset.via === "binance");
}

/** The aggregator router `asset` actually swaps through on `chain` (Kyber or Binance). */
export function aggregatorRouterFor(chain: StaxChain, asset: Asset | null | undefined): `0x${string}` | undefined {
  if (asset?.via === "binance" && chain.routers.binance) return chain.routers.binance;
  return chain.routers.kyber;
}

/**
 * The message to show for a failed /api/swap-quote call: the server's own text — "NVDA is
 * closed right now; it opens…", "below Binance's $6 minimum" — when the body has one, else a
 * generic fallback. Pure so the extraction rule (not just "some UI showed something") is a
 * plain test; `fetchSwapQuote` and `quoteErrorMessage` both build on it.
 */
export function swapQuoteErrorMessage(json: unknown, fallback = "Couldn't get a price right now."): string {
  const error = (json as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : fallback;
}

/**
 * The message a quote-fetching hook (useQuote / useSellQuote) should show for its query's
 * `error`. Only a real Error carries a message worth showing — react-query can hand back
 * anything a thrown value happened to be — so anything else reads as "no message", never a
 * stringified `[object Object]`.
 */
export function quoteErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/**
 * Binance's own dry run is the final word only when it actually ran and said this exact trade
 * would revert. Called right before a swap is sent (useSwap's aggregatorCalls); "skipped" (no
 * approval yet — the common case for a first trade of a token) and "passed" both let it
 * through, and no dry run at all (any non-BSC chain) is a no-op.
 */
export function assertDryRunAllowsSend(dryRun: DryRun | undefined): void {
  if (dryRun?.status !== "failed") return;
  throw new Error(dryRun.reason ?? "Binance checked this trade and it wouldn't go through right now.");
}

export async function fetchSwapQuote(args: SwapQuoteArgs): Promise<SwapQuote> {
  const res = await authedFetch("/api/swap-quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...args, amountIn: args.amountIn.toString() }),
  });
  const json = (await res.json().catch(() => null)) as (SwapQuoteWire & { error?: string }) | null;
  if (!res.ok || !json) {
    throw new Error(swapQuoteErrorMessage(json));
  }
  return {
    router: json.router,
    tokenIn: json.tokenIn,
    tokenOut: json.tokenOut,
    amountIn: BigInt(json.amountIn),
    amountOut: BigInt(json.amountOut),
    minOut: BigInt(json.minOut),
    ...(json.data ? { data: json.data } : {}),
    ...(json.dryRun ? { dryRun: json.dryRun } : {}),
    expiresAt: json.expiresAt,
  };
}
