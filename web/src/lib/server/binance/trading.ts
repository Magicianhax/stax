import "server-only";

// The DEX aggregator, prefix /api/v1/dex/aggregator (docs/BINANCE-WEB3.md §4). This is Stax's
// only source of BSC swap calldata: the router is `chain.routers.binance`, and both the quote
// and the swap must be checked against it before anything is returned for signing (a contract
// cannot sign an RFQ order, and an unrecognised router is an attack surface — Review Focus #5).
import { z } from "zod";
import { web3Request } from "./client";
import { BinanceWeb3Error } from "./types";
import type { AggQuote, AggQuoteAndSwap, AggSwapBuild, QuoteParams } from "./types";

const BINANCE_CHAIN_ID = "56";

const wireDexList = z
  .object({ dexRouterList: z.array(z.object({ dexProtocol: z.object({ dexName: z.string() }).passthrough() }).passthrough()) })
  .passthrough();

/** The route's dex names, deduplicated; empty when the wire carried no list. */
function dexNamesOf(route: unknown): string[] {
  const parsed = wireDexList.safeParse(route);
  return parsed.success ? [...new Set(parsed.data.dexRouterList.map((d) => d.dexProtocol.dexName))] : [];
}

// `data` is an array of routes; every live call in research returned exactly one.
const wireQuoteRoute = z
  .object({
    quoteId: z.string(),
    vendorName: z.string(),
    executionMode: z.enum(["SWAP", "RFQ"]),
    fromTokenAmount: z.string(),
    toTokenAmount: z.string(),
    priceImpactPercent: z.string(),
    approveTarget: z.string(),
  })
  .passthrough();

/**
 * `userWalletAddress` is sent on every call, never made conditional: the research found it
 * required whenever a pair *could* route through Ondo RFQ, and there is no cheap way to know
 * that in advance (docs/BINANCE-WEB3.md §4).
 */
export async function quote(p: QuoteParams): Promise<AggQuote> {
  const data = await web3Request<unknown>("GET", "/api/v1/dex/aggregator/quote", {
    binanceChainId: BINANCE_CHAIN_ID,
    fromTokenAddress: p.fromToken,
    toTokenAddress: p.toToken,
    amount: p.amount.toString(),
    userWalletAddress: p.taker,
    slippagePercent: p.slippagePercent,
  });
  const parsed = z.array(wireQuoteRoute).safeParse(data);
  if (!parsed.success || parsed.data.length === 0) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/aggregator/quote", 200);
  }
  const route = parsed.data[0];
  return {
    quoteId: route.quoteId,
    vendorName: route.vendorName,
    executionMode: route.executionMode,
    fromTokenAmount: BigInt(route.fromTokenAmount),
    toTokenAmount: BigInt(route.toTokenAmount),
    priceImpactPercent: Number(route.priceImpactPercent),
    approveTarget: route.approveTarget as `0x${string}`,
    dexNames: dexNamesOf(route),
    raw: route,
  };
}

const wireSwapTx = z
  .object({
    from: z.string(),
    to: z.string(),
    data: z.string(),
    value: z.string(),
    gas: z.string(),
    gasPrice: z.string(),
    minReceiveAmount: z.string(),
  })
  .passthrough();

const wireSwapBuild = z
  .object({
    executionMode: z.enum(["SWAP", "RFQ"]),
    tx: wireSwapTx,
  })
  .passthrough();

export async function buildSwap(p: QuoteParams & { quoteId: string; slippagePercent: string }): Promise<AggSwapBuild> {
  const data = await web3Request<unknown>("GET", "/api/v1/dex/aggregator/swap", {
    binanceChainId: BINANCE_CHAIN_ID,
    fromTokenAddress: p.fromToken,
    toTokenAddress: p.toToken,
    amount: p.amount.toString(),
    userWalletAddress: p.taker,
    quoteId: p.quoteId,
    slippagePercent: p.slippagePercent,
  });
  const parsed = wireSwapBuild.safeParse(data);
  if (!parsed.success) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/aggregator/swap", 200);
  }
  return toSwapBuild(parsed.data);
}

function toSwapBuild(b: z.infer<typeof wireSwapBuild>): AggSwapBuild {
  const { tx } = b;
  return {
    executionMode: b.executionMode,
    tx: {
      from: tx.from as `0x${string}`,
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: tx.value,
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      minReceiveAmount: BigInt(tx.minReceiveAmount),
    },
    dexNames: dexNamesOf(b.routerResult),
  };
}

const wireQuoteAndSwap = wireSwapBuild.extend({
  routerResult: z
    .object({ fromTokenAmount: z.string(), toTokenAmount: z.string(), priceImpactPercent: z.string() })
    .passthrough(),
});

/**
 * `/quote-and-swap` (LIVE 2026-10-09): one call that prices and builds, and the only aggregator
 * endpoint that honours `excludeDexes` — `/quote` and `/swap` ignore it, and every endpoint
 * ignores `enableRfq=false`. It requires `vendor`; "LiquidMesh" is the vendor behind every live
 * route. Its `routerResult` carries no quoteId and no approveTarget: the spender is the router
 * `tx.to` names, which callers assert.
 */
export async function quoteAndSwap(p: QuoteParams & { slippagePercent: string; excludeDexes: string[] }): Promise<AggQuoteAndSwap> {
  const data = await web3Request<unknown>("GET", "/api/v1/dex/aggregator/quote-and-swap", {
    binanceChainId: BINANCE_CHAIN_ID,
    fromTokenAddress: p.fromToken,
    toTokenAddress: p.toToken,
    amount: p.amount.toString(),
    userWalletAddress: p.taker,
    slippagePercent: p.slippagePercent,
    vendor: "LiquidMesh",
    excludeDexes: p.excludeDexes.join(","),
  });
  const parsed = wireQuoteAndSwap.safeParse(Array.isArray(data) ? data[0] : data);
  if (!parsed.success) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/aggregator/quote-and-swap", 200);
  }
  const r = parsed.data.routerResult;
  return {
    quote: {
      fromTokenAmount: BigInt(r.fromTokenAmount),
      toTokenAmount: BigInt(r.toTokenAmount),
      priceImpactPercent: Number(r.priceImpactPercent),
      dexNames: dexNamesOf(r),
    },
    build: toSwapBuild(parsed.data),
  };
}
