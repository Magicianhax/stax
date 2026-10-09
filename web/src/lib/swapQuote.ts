"use client";

// Client for POST /api/swap-quote — KyberSwap aggregator quotes + calldata on aggregator
// chains (Base). Shared by useQuote (build=false, display) and useSwap (build=true,
// fetched immediately before the UserOp is sent — Kyber routes are good for ~10s).
import { authedFetch } from "@/lib/authedFetch";
import type { Asset, RwaPlatform, StaxChain } from "@/lib/chains";
import type { DryRun } from "@/lib/dryRun";
import { formatOpensLocal } from "@/lib/marketHours";

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
  /** With build=true: the floor the person reviewed, raw units of the output token (lib/slippage.ts). */
  reviewedMinOut?: bigint;
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
 * The refusals /api/swap-quote marks as meant for the person (design critique P0 #3), so the
 * client never string-matches server text: a closed market (with `nextOpenMs`), the $6 minimum,
 * and the per-user price-check limit. Anything without a code is an internal or upstream
 * problem and is never shown verbatim.
 */
export type SwapQuoteErrorCode = "closed" | "min_trade" | "rate_limited" | "price_moved" | "no_fill";
const CODES: ReadonlySet<string> = new Set<SwapQuoteErrorCode>(["closed", "min_trade", "rate_limited", "price_moved", "no_fill"]);

export class SwapQuoteError extends Error {
  constructor(
    message: string,
    readonly code?: SwapQuoteErrorCode,
    readonly nextOpenMs?: number | null,
  ) {
    super(message);
    this.name = "SwapQuoteError";
  }
}

/** A failed /api/swap-quote response as a typed error. Any 429 is the per-user limit. */
export function swapQuoteErrorFrom(json: unknown, status: number): SwapQuoteError {
  const body = (json ?? {}) as { code?: unknown; nextOpenMs?: unknown };
  const code =
    status === 429 ? "rate_limited" : typeof body.code === "string" && CODES.has(body.code) ? (body.code as SwapQuoteErrorCode) : undefined;
  const nextOpenMs = typeof body.nextOpenMs === "number" ? body.nextOpenMs : null;
  return new SwapQuoteError(swapQuoteErrorMessage(json), code, nextOpenMs);
}

export interface QuoteProblemContext {
  bsc: boolean;
  /** "Nvidia" — displayFor's name, never the ticker. */
  companyName: string;
  /** BSC: the issuer this trade uses ("bStock"). */
  issuer?: string;
  /** BSC: the other issuer of the same share, when there is one to suggest. */
  otherIssuer?: string;
  side: "buy" | "sell";
  nowMs?: number;
}

/**
 * The one sentence Trade shows for a failed quote (or a swap that failed at its build-time
 * quote). User-meant refusals keep their meaning; everything else — RFQ routes, an unexpected
 * router, "No swap route", an aggregator amount change — becomes the same plain sentence
 * naming the company and the issuer, with a next step. Undefined when there is no error.
 */
export function quoteProblemText(error: unknown, ctx: QuoteProblemContext): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error instanceof SwapQuoteError) {
    if (error.code === "min_trade" || error.code === "price_moved") return error.message;
    if (error.code === "rate_limited") return "Too many price checks — wait a few seconds";
    // Trade moves the buy to the other issuer on its own when that one is open; this is what is
    // left when it can't (lib/server/binanceLegs.ts "no_fill").
    if (error.code === "no_fill" && !(ctx.side === "buy" && ctx.otherIssuer)) {
      return `Binance has no seller for ${ctx.companyName} right now. Try again in a few minutes.`;
    }
    if (error.code === "closed" && typeof error.nextOpenMs === "number") {
      return `${ctx.companyName} is closed right now. It ${formatOpensLocal(error.nextOpenMs, ctx.nowMs)}.`;
    }
  }
  if (!ctx.bsc || !ctx.issuer) return `We can't get a price for ${ctx.companyName} right now. Try again in a few minutes.`;
  const what = ctx.side === "buy" ? `buy ${ctx.companyName} from ${ctx.issuer}` : `sell ${ctx.companyName} through ${ctx.issuer}`;
  const other = ctx.side === "buy" && ctx.otherIssuer ? `Try ${ctx.otherIssuer}, or try again in a few minutes.` : "Try again in a few minutes.";
  return `We can't ${what} right now. ${other}`;
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
 * would revert. Called right before a swap is sent (useSwap's aggregatorCalls); "skipped" (this
 * wallet hasn't sent its first on-chain trade yet, so Binance has no deployed contract to
 * simulate against — see lib/server/dryRun.ts) and "passed" both let it through, and no dry run
 * at all (any non-BSC chain) is a no-op.
 */
export function assertDryRunAllowsSend(dryRun: DryRun | undefined): void {
  if (dryRun?.status !== "failed") return;
  throw new DryRunRefusal(dryRun.reason ?? "Binance checked this trade and it wouldn't go through right now.");
}

/**
 * Binance's check said this trade would revert, so nothing was sent. Typed so Trade shows it as
 * a normal refusal the person can act on, not the red "your trade failed" banner reserved for a
 * submitted trade that reverted.
 */
export class DryRunRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DryRunRefusal";
  }
}

export async function fetchSwapQuote(args: SwapQuoteArgs): Promise<SwapQuote> {
  const res = await authedFetch("/api/swap-quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...args,
      amountIn: args.amountIn.toString(),
      reviewedMinOut: args.reviewedMinOut?.toString(),
    }),
  });
  const json = (await res.json().catch(() => null)) as (SwapQuoteWire & { error?: string }) | null;
  if (!res.ok || !json) {
    throw swapQuoteErrorFrom(json, res.status);
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
