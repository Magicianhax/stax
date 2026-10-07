// POST /api/swap-quote — aggregator quote (and optionally calldata) for the Pro manual
// buy/sell panel: KyberSwap on Base, the Binance Web3 DEX aggregator on BSC.
//
//   body     { symbol, side: "buy" | "sell", amountIn: string (raw units of tokenIn),
//              sender, recipient, slippageBps?: number (default 100), build?: boolean }
//   buy      cash -> asset      sell  asset -> cash
//   response { router, tokenIn, tokenOut, amountIn, amountOut, minOut, data?, expiresAt }
//            amounts are raw-unit decimal strings; `data` (router calldata) only when build=true;
//            `expiresAt` is unix ms — routes are good for ~10s, so the client fetches with
//            build=true immediately before sending the UserOp.
//   errors   400 unknown / coming / non-routable symbol, sub-$6 BSC leg, or bad body ·
//            404 no Kyber route · 409 BSC token isn't buyable right now (Review Focus #1) ·
//            429 per-user limit · 502 aggregator down
//            Refusals meant for the person carry `code` ("closed" + nextOpenMs, "min_trade",
//            "rate_limited"); the client (lib/swapQuote.ts quoteProblemText) shows its own plain
//            words for everything uncoded instead of echoing this route's text.
//
// The client's sponsored UserOp is [ fee → treasury (buys, Base/Mantle only — ADR-0007 makes
// BSC fee-free), ERC20.approve(router, amountIn), { to: router, data } ]. `sender` = `recipient`
// = the user's smart account, so the router pulls tokenIn from the account and delivers tokenOut
// back to it. On BSC that "delivers back to it" is Binance's own msg.sender-only behaviour
// (docs/BINANCE-WEB3.md §10) rather than an explicit recipient argument — either way the account
// that calls the router is the one that receives the output.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { assetBySymbol, isRoutable } from "@/lib/chains";
import { KyberError, KyberNoRoute, kyberBuild, kyberRoute } from "@/lib/server/kyber";
import { BinanceLegError, BinanceLegRefusal, bscLegUsdValue, buildBinanceLeg, checkBscBuyable, cryptoLegUsdValue } from "@/lib/server/binanceLegs";
import { priceAsset } from "@/lib/prices";
import { anchoredSlippageBps, PRICE_MOVED_MESSAGE, reviewedFloorRequiredMessage } from "@/lib/slippage";
import { chainFromRequest, serverClient } from "@/lib/server/chain";
import { getBinanceWeb3 } from "@/lib/server/binance";
import { dryRunBscSwap } from "@/lib/server/dryRun";
import type { DryRun } from "@/lib/dryRun";
import { resolveVenueAddress } from "@/lib/venues";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { getSmartAccount } from "@/lib/server/users";
import { unauthorized, badRequest, tooManyRequests, serverError, jsonError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BPS = BigInt(10_000);
const DEFAULT_SLIPPAGE_BPS = 100;
const DEADLINE_SECONDS = 15 * 60;
/** How long a returned quote / calldata is considered fresh by the client. */
const QUOTE_TTL_MS = 10_000;

/** Users we've already warned about (no smart_accounts row yet) — once per instance. */
const warnedNoAccount = new Set<string>();

const SwapQuoteRequestSchema = z.object({
  symbol: z.string().min(1).max(16),
  side: z.enum(["buy", "sell"]),
  amountIn: z.string().regex(/^\d{1,40}$/, "amountIn must be a raw integer string."),
  sender: z.string().refine((a) => isAddress(a), "Invalid sender."),
  recipient: z.string().refine((a) => isAddress(a), "Invalid recipient."), // must equal sender (checked below)
  slippageBps: z.number().int().min(0).max(2000).optional(),
  build: z.boolean().optional(),
  /**
   * With build=true: the floor the person reviewed (raw units of the output token). The swap is
   * built so its minimum can't fall below it, or refused as "price_moved" (lib/slippage.ts).
   */
  reviewedMinOut: z.string().regex(/^\d{1,40}$/).optional(),
  /** BSC only: which issuer to trade (bStock vs Ondo). Ignored off BSC. */
  venue: z.enum(["bstock", "ondo"]).optional(),
});

export interface SwapQuoteResponse {
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  amountOut: string;
  minOut: string;
  /** Router calldata — present only when the request had build=true. */
  data?: `0x${string}`;
  /** Unix ms after which the client should re-quote. */
  expiresAt: number;
  /**
   * BSC only, present only when build=true: a Binance Transaction API dry run of this exact
   * swap, run right before the client is expected to sign it. Never claims a check that
   * didn't run (see lib/dryRun.ts and lib/server/dryRun.ts) — a "failed" status means the
   * client must not send this trade.
   */
  dryRun?: DryRun;
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  // Private beta: only approved users may spend (no-op while NEXT_PUBLIC_PRIVATE_BETA is off).
  const gate = await requireApproved(user);
  if (gate) return gate;

  // Quotes refetch on every keystroke burst + a 15s interval; 120/min is ample.
  const limit = await rateLimit(`swap-quote:${user.userId}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const chain = chainFromRequest(req);
  // BSC quotes spend Binance's shared 5-per-window budget (security review 2026-09-25): one
  // user may not take more than one live quote every few seconds, so a busy screen can't starve
  // everyone else's trades. Repeat price checks are also shared for 15s in buildBinanceLeg.
  if (chain.routers.binance) {
    const bscLimit = await rateLimit(`swap-quote:bsc:${user.userId}`, 20, 60_000);
    if (!bscLimit.ok) return tooManyRequests(bscLimit.retryAfter);
  }
  if (!chain.routers.kyber && !chain.routers.binance) {
    return badRequest(`Aggregator quotes are not available on ${chain.name}.`);
  }

  let body: z.infer<typeof SwapQuoteRequestSchema>;
  try {
    body = SwapQuoteRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  const asset = assetBySymbol(chain, body.symbol);
  if (!asset || !asset.address || asset.via === "aave_v3" || !isRoutable(chain, body.symbol)) {
    return badRequest(`That asset isn't tradable on ${chain.name} yet.`);
  }
  const amountIn = BigInt(body.amountIn);
  if (amountIn <= BigInt(0)) return badRequest("Amount too small.");

  // `venue` only matters on BSC (resolveVenueAddress ignores it everywhere else): the asset's
  // own address by default, the twin's when the caller names it, 400 for a venue this ticker
  // doesn't have. Every check below — the buyable gate, the $6 floor, the quote itself — uses
  // this RESOLVED address, never `asset.address`, so a chosen Ondo trade can't accidentally
  // price or gate against bStock's token.
  const resolved = resolveVenueAddress(chain, asset, body.venue);
  if (!resolved) return badRequest(`${asset.symbol} isn't offered by ${body.venue === "ondo" ? "Ondo" : "bStock"} on ${chain.name}.`);

  const usdc = chain.usdc.address;
  const tokenIn = body.side === "buy" ? usdc : resolved.address;
  const tokenOut = body.side === "buy" ? resolved.address : usdc;
  const slippageBps = body.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const sender = body.sender as `0x${string}`;
  const recipient = body.recipient as `0x${string}`;
  // Hard rule: output always returns to the account that pays. Calldata built for a
  // third-party sender with a different recipient is never produced by this API, so a
  // stray allowance to the public Kyber router can never be redirected through Stax.
  if (sender.toLowerCase() !== recipient.toLowerCase()) {
    return badRequest("sender and recipient must be the same account.");
  }
  // …and that account must be the caller's own smart account on this chain (the one
  // useSmartAccount() registered via /api/me/account). No row yet → allow, warn once.
  const account = await getSmartAccount(user.userId, chain.key);
  if (account) {
    if (account.address.toLowerCase() !== sender.toLowerCase()) {
      return jsonError(403, "Quote must be for your own account.");
    }
  } else if (!warnedNoAccount.has(user.userId)) {
    warnedNoAccount.add(user.userId);
    console.warn(`[swap-quote] no smart_accounts row for user ${user.userId} on ${chain.key}; sender unverified`);
  }

  const binanceVenue = Boolean(chain.routers.binance && asset.via === "binance");

  if (binanceVenue) {
    const floorMessage = reviewedFloorRequiredMessage(body);
    if (floorMessage) return badRequest(floorMessage);
    // Review Focus #1: refuse before ever asking Binance for a quote when the issuer isn't
    // trading this token right now (fails closed if the catalog doesn't even list it).
    // Crypto (BTCB, ETH, BNB) has no RWA row and no market hours: it trades whenever the
    // aggregator quotes it, so it skips the closed-market gate on both sides.
    let usdValue: number;
    if (asset.tier === "crypto") {
      const priceUsd = body.side === "sell" ? (await priceAsset(chain, serverClient(chain), asset)).priceUsd : undefined;
      usdValue = cryptoLegUsdValue(body.side, chain, amountIn, asset, priceUsd);
    } else {
      let tokens: Awaited<ReturnType<ReturnType<typeof getBinanceWeb3>["rwaTokens"]>>;
      try {
        tokens = await getBinanceWeb3().rwaTokens();
      } catch (err) {
        return serverError("swap-quote", err);
      }
      const gate = checkBscBuyable(tokens, resolved.address, asset.symbol, Date.now());
      // `code: "closed"` only with a real reopen instant — the client re-says it in the viewer's
      // own clock; an unlisted token (no instant) gets the client's plain generic sentence.
      if (!gate.ok) {
        return Response.json(
          { error: gate.message, nextOpenMs: gate.nextOpenMs ?? null, ...(gate.nextOpenMs ? { code: "closed" } : {}) },
          { status: 409 },
        );
      }
      usdValue = bscLegUsdValue(body.side, chain, amountIn, asset, gate.row);
    }

    try {
      const leg = await buildBinanceLeg({
        chain,
        symbol: asset.symbol,
        tokenIn,
        tokenOut,
        amountIn,
        taker: sender,
        slippageBps,
        usdValue,
        side: body.side,
        ...(body.reviewedMinOut ? { reviewedMinOut: BigInt(body.reviewedMinOut) } : {}),
        build: Boolean(body.build),
      });
      // Dry run only when there is a real swap to check (build=true — right before the user
      // signs), never on the price-only quotes TradeScreen polls every 15s: that would spend
      // the shared 5-per-window Binance budget on a check nobody is about to act on.
      let dryRun: DryRun | undefined;
      if (body.build) {
        dryRun = await dryRunBscSwap({
          chain,
          taker: sender,
          router: leg.router,
          tokenIn,
          tokenOut,
          amountIn,
          swapData: leg.swapData,
        });
      }
      const result: SwapQuoteResponse = {
        router: leg.router,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        amountOut: leg.expectedOut.toString(),
        minOut: leg.minOut.toString(),
        ...(body.build ? { data: leg.swapData } : {}),
        ...(dryRun ? { dryRun } : {}),
        expiresAt: Date.now() + QUOTE_TTL_MS,
      };
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (err instanceof BinanceLegError) {
        console.error("[swap-quote]", err.message);
        return jsonError(502, "We couldn't get a price just now. Try again in a moment.");
      }
      if (err instanceof BinanceLegRefusal) {
        // Design critique P0 #3: a "route" refusal (RFQ, unexpected router, changed amount) is
        // real, but its words are for the log — the client shows its own plain sentence.
        if (err.code === "route") {
          console.error("[swap-quote]", err.message);
          return jsonError(502, "We couldn't get a price just now. Try again in a moment.");
        }
        return jsonError(400, err.message, undefined, err.code ? { code: err.code } : undefined);
      }
      return serverError("swap-quote", err);
    }
  }

  try {
    const route = await kyberRoute(chain, { tokenIn, tokenOut, amountIn });
    if (!route) return jsonError(404, `No swap route for ${asset.symbol} on ${chain.name} right now.`);

    let amountOut = route.amountOut;
    let data: `0x${string}` | undefined;
    let buildSlippageBps = slippageBps;
    if (body.build) {
      // Same anchoring as BSC: the build's tolerance can't reach below the floor that was reviewed.
      const anchored = anchoredSlippageBps({
        freshExpectedOut: route.amountOut,
        reviewedMinOut: body.reviewedMinOut ? BigInt(body.reviewedMinOut) : undefined,
        slippageBps,
      });
      if (anchored === null) return jsonError(400, PRICE_MOVED_MESSAGE, undefined, { code: "price_moved" });
      buildSlippageBps = anchored;
      const built = await kyberBuild(chain, {
        routeSummary: route.routeSummary,
        sender,
        recipient,
        slippageBps: buildSlippageBps,
        deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
      });
      if (built.amountIn !== amountIn) return jsonError(502, "The aggregator changed the swap amount. Please try again.");
      amountOut = built.amountOut;
      data = built.data;
    }
    const minOut = (amountOut * (BPS - BigInt(buildSlippageBps))) / BPS;

    const result: SwapQuoteResponse = {
      router: route.routerAddress,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      minOut: minOut.toString(),
      ...(data ? { data } : {}),
      expiresAt: Date.now() + QUOTE_TTL_MS,
    };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof KyberNoRoute) return jsonError(404, `No swap route for ${asset.symbol} on ${chain.name} right now.`);
    if (err instanceof KyberError) {
      console.error("[swap-quote]", err.message);
      return jsonError(502, "We couldn't get a price just now. Try again in a moment.");
    }
    return serverError("swap-quote", err);
  }
}
