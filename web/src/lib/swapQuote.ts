"use client";

// Client for POST /api/swap-quote — KyberSwap aggregator quotes + calldata on aggregator
// chains (Base). Shared by useQuote (build=false, display) and useSwap (build=true,
// fetched immediately before the UserOp is sent — Kyber routes are good for ~10s).
import { authedFetch } from "@/lib/authedFetch";
import type { Asset, StaxChain } from "@/lib/chains";

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
}

export interface SwapQuoteArgs {
  symbol: string;
  side: "buy" | "sell";
  amountIn: bigint;
  sender: `0x${string}`;
  recipient: `0x${string}`;
  slippageBps?: number;
  build?: boolean;
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

export async function fetchSwapQuote(args: SwapQuoteArgs): Promise<SwapQuote> {
  const res = await authedFetch("/api/swap-quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...args, amountIn: args.amountIn.toString() }),
  });
  const json = (await res.json().catch(() => null)) as (SwapQuoteWire & { error?: string }) | null;
  if (!res.ok || !json) {
    throw new Error(typeof json?.error === "string" ? json.error : "Couldn't get a price right now.");
  }
  return {
    router: json.router,
    tokenIn: json.tokenIn,
    tokenOut: json.tokenOut,
    amountIn: BigInt(json.amountIn),
    amountOut: BigInt(json.amountOut),
    minOut: BigInt(json.minOut),
    ...(json.data ? { data: json.data } : {}),
    expiresAt: json.expiresAt,
  };
}
