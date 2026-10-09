"use client";

// useSwap — Pro manual buy/sell: a direct, gasless swap on the active chain.
//
// Buy = one sponsored UserOp:
//   [ fee -> treasury, USDC.approve(venue, net), venue.swap({ ..., recipient: USER }) ]
// Sell = one sponsored UserOp:
//   [ asset.approve(venue, amt), venue.swap({ ..., recipient: USER }) ]
//
// Venue by `chain.routers.kyber` / `chain.routers.v3Kind` / `Asset.via` / `chain.routes[symbol]`:
//   kyber       (Base)    KyberSwap aggregator: calldata from POST /api/swap-quote (build=true,
//                         sender = recipient = the user's smart account) fetched right before
//                         sending; [ approve(router, amountIn), { to: router, data } ]
//   fluxion     (Mantle)  exactInputSingle WITH deadline on chain.routers.v3
//   uniswap_v3  (Base)    SwapRouter02 exactInputSingle, NO deadline (kept as the fallback)
//   agni route  (Mantle)  exactInput(path) WITH deadline, multi-hop
//   aave_v3     (Base)    Pool.supply(USDC) -> aUSDC / Pool.withdraw(USDC) (no approval on sell)
//
// Unlike the AI invest flow (which routes through StaxExecutor), here the
// smart account swaps directly and the bought tokens land in the user's account.
import { useCallback, useState } from "react";
import { encodeFunctionData } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { getSmartAccountClient, sendBuiltCalls, type Call } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { AAVE_POOL_ABI, AGNI_ROUTER_ABI, ERC20_ABI, FLUXION_ROUTER_ABI, UNISWAP_ROUTER02_ABI } from "@/lib/abis";
import { isRoutable, reverseRoute, type Asset, type RouteHop, type RwaPlatform, type StaxChain } from "@/lib/chains";
import type { DryRun } from "@/lib/dryRun";
import { useChain } from "@/lib/chains/active";
import { encodeV3Path, singleHopSqrtLimit } from "@/lib/swapRouting";
import { aggregatorRouterFor, assertDryRunAllowsSend, fetchSwapQuote, usesAggregator } from "@/lib/swapQuote";
import { feeOf, STAX_TREASURY } from "@/lib/fees";
import { clearsReviewedFloor, PriceMovedError } from "@/lib/slippage";
import { usdToRaw } from "@/lib/units";
import { resolveVenueAddress } from "@/lib/venues";

type Phase = "idle" | "swapping" | "done" | "error";

const BPS = BigInt(10000);
const DEADLINE_SECONDS = 15 * 60;
/** Fresh builds an aggregator trade may be re-sent with after a failed op (lib/aa.ts sendBuiltCalls). */
const AGGREGATOR_RESENDS = 2;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Canned receipt hash for demo-mode buys/sells on Base (never broadcast on-chain). On BNB Chain the
// demo records the trade in its session and uses the hash that returns.
const DEMO_SWAP_TX = ("0x" + "5a7c2b41".repeat(32).slice(0, 64)) as `0x${string}`;

const approve = (token: `0x${string}`, spender: `0x${string}`, amount: bigint): Call => ({
  to: token,
  data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] }),
});

/** Multi-hop exactInput on the route's router (Agni has a deadline, Uniswap SwapRouter02 doesn't). */
function routeSwapCall(
  chain: StaxChain,
  symbol: string,
  hops: RouteHop[],
  recipient: `0x${string}`,
  amountIn: bigint,
  amountOutMinimum: bigint,
): Call {
  const route = chain.routes[symbol];
  const path = encodeV3Path(hops);
  if (route.kind === "agni_v3") {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
    return {
      to: route.router,
      data: encodeFunctionData({
        abi: AGNI_ROUTER_ABI,
        functionName: "exactInput",
        args: [{ path, recipient, deadline, amountIn, amountOutMinimum }],
      }),
    };
  }
  return {
    to: route.router,
    data: encodeFunctionData({
      abi: UNISWAP_ROUTER02_ABI,
      functionName: "exactInput",
      args: [{ path, recipient, amountIn, amountOutMinimum }],
    }),
  };
}

/** Single-hop exactInputSingle on `chain.routers.v3` (Fluxion has a deadline, SwapRouter02 doesn't). */
function singleHopSwapCall(
  chain: StaxChain,
  p: {
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    fee: number;
    recipient: `0x${string}`;
    amountIn: bigint;
    amountOutMinimum: bigint;
    sqrtPriceLimitX96: bigint;
  },
): Call {
  if (chain.routers.v3Kind === "fluxion") {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
    return {
      to: chain.routers.v3,
      data: encodeFunctionData({ abi: FLUXION_ROUTER_ABI, functionName: "exactInputSingle", args: [{ ...p, deadline }] }),
    };
  }
  return {
    to: chain.routers.v3,
    data: encodeFunctionData({ abi: UNISWAP_ROUTER02_ABI, functionName: "exactInputSingle", args: [p] }),
  };
}

/**
 * Aggregator swap: [ approve(router, amountIn), router.swap(data) ]. `asset.via` picks the
 * router (KyberSwap on Base, the Binance Web3 aggregator on BSC — `aggregatorRouterFor`). The
 * calldata is built server-side for sender = recipient = `account` and is only good for ~10s,
 * so this runs immediately before sendSponsoredCalls. The returned router must match the one
 * the chain config (and the executor whitelist, once deployed) names — anything else is
 * refused, mirroring `assertWhitelistedRouter` server-side.
 */
async function aggregatorCalls(
  chain: StaxChain,
  p: {
    asset: Asset;
    side: "buy" | "sell";
    tokenIn: `0x${string}`;
    amountIn: bigint;
    account: `0x${string}`;
    slippageBps: number;
    /** The floor the person reviewed (output token, raw). The swap is built to never go below it. */
    reviewedMinOut: bigint;
    venue?: RwaPlatform;
  },
): Promise<{ calls: Call[]; minOut: bigint; dryRun?: DryRun }> {
  const q = await fetchSwapQuote({
    symbol: p.asset.symbol,
    side: p.side,
    amountIn: p.amountIn,
    sender: p.account,
    recipient: p.account,
    slippageBps: p.slippageBps,
    reviewedMinOut: p.reviewedMinOut,
    build: true,
    venue: p.venue,
  });
  const router = aggregatorRouterFor(chain, p.asset);
  if (!router || q.router.toLowerCase() !== router.toLowerCase() || !q.data) {
    throw new Error("The swap route didn't match this network. Please try again.");
  }
  if (q.amountIn !== p.amountIn) throw new Error("The swap amount changed. Please try again.");
  // Binance's own check on this exact trade (BSC only) is the final word when it ran and
  // says the trade would revert — never sent in that case. A "skipped" check (this wallet
  // hasn't sent its first on-chain trade yet, so there's nothing deployed to simulate
  // against) or no check at all (every other chain) both fall through normally.
  assertDryRunAllowsSend(q.dryRun);
  // The server anchors the build to the reviewed floor (lib/slippage.ts); this is the backstop
  // that a swap whose minimum sits below what the sheet promised is never signed.
  if (!clearsReviewedFloor(q.minOut, p.reviewedMinOut)) throw new PriceMovedError();
  // Belt-and-suspenders for the twin-venue bug this guards against elsewhere (TradeScreen's
  // holding lookup, resolveVenueAddress): the approve below is built from OUR resolved
  // `p.tokenIn`, so if the server's quote ever disagreed about which token this trade means,
  // approving `p.tokenIn` while the router pulls a different one would silently move the wrong
  // token. Catch that here instead of letting a UserOp revert (or worse, half-succeed) explain it.
  if (q.tokenIn.toLowerCase() !== p.tokenIn.toLowerCase()) {
    throw new Error("The swap route didn't match the selected venue. Please try again.");
  }
  // Kyber: reset the allowance to 0 after the swap (mirrors the executor) so a partially
  // consumed approval never lingers on the public router. Binance: the approve is already
  // exact-amount and single-use, and its router expects no such reset — skip the third call.
  const calls = [approve(p.tokenIn, router, p.amountIn), { to: router, data: q.data }];
  if (router.toLowerCase() === chain.routers.kyber?.toLowerCase()) calls.push(approve(p.tokenIn, router, BigInt(0)));
  return { calls, minOut: q.minOut, dryRun: q.dryRun };
}

export interface SwapResult {
  txHash: `0x${string}`;
  asset: Asset;
  amountUsd: number;
  /** "buy" (USDC -> asset) or "sell" (asset -> USDC). */
  side: "buy" | "sell";
  /** BSC only: the Binance check this trade passed (or was skipped) before signing. */
  dryRun?: DryRun;
}

export function useSwap() {
  const activeWallet = useActiveWallet();
  const chain = useChain();
  // In demo mode (landing phones + /demo) the app must never broadcast a real
  // swap — even when a real Privy wallet is connected from a prior /app login.
  const demo = useDemo();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // The thrown value behind `error`, so Trade can re-word a swap-quote refusal (a
  // SwapQuoteError from the build-time quote) instead of showing server text (P0 #3).
  const [errorCause, setErrorCause] = useState<unknown>(null);
  const [result, setResult] = useState<SwapResult | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setErrorCause(null);
    setResult(null);
  }, []);

  /**
   * Buy `asset` with `amountUsd`, accepting at least `expectedOutRaw` minus
   * `slippageBps`. `recipient` is the user's smart-account address.
   */
  const buy = useCallback(
    async (params: {
      asset: Asset;
      amountUsd: number;
      expectedOutRaw: bigint;
      slippageBps: number;
      recipient: string;
      /** BSC only: the issuer this quote was built against. Ignored elsewhere. */
      venue?: RwaPlatform;
    }) => {
      const { asset, amountUsd, expectedOutRaw, slippageBps, recipient: rcpt, venue } = params;
      const recipient = rcpt as `0x${string}`;
      setError(null);
      setErrorCause(null);
      setResult(null);
      // Demo mode: simulate a successful buy without ever touching the chain.
      if (demo) {
        setPhase("swapping");
        await sleep(1400);
        if (demo.rwa) {
          // BNB Chain demo: the same check and the same refusals as a real quote, then the trade
          // is kept in this session only (Home, Owned and the wallet show it).
          try {
            const q = demo.quote({ asset, side: "buy", amountIn: usdToRaw(chain, amountUsd), venue });
            const qty = Number(q.amountOut) / 10 ** (asset.decimals ?? 18);
            const txHash = demo.recordTrade({ side: "buy", symbol: asset.symbol, venue, usd: amountUsd, qty });
            setResult({ txHash, asset, amountUsd, side: "buy", dryRun: q.dryRun });
            setPhase("done");
          } catch (e) {
            setError(e instanceof Error ? e.message : "The buy didn't go through.");
            setErrorCause(e);
            setPhase("error");
          }
          return;
        }
        setResult({ txHash: DEMO_SWAP_TX, asset, amountUsd, side: "buy" });
        setPhase("done");
        return;
      }
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        if (!asset.address || !isRoutable(chain, asset.symbol)) {
          throw new Error(`${asset.symbol} isn't buyable on ${chain.name} yet.`);
        }

        const assetAddress = asset.address;
        const usdc = chain.usdc.address;
        const amountIn = usdToRaw(chain, amountUsd);
        if (amountIn <= BigInt(0)) throw new Error("Enter an amount first.");
        // Platform fee skimmed to the treasury (gasless, batched below); the rest
        // is what we actually swap. expectedOutRaw was quoted for the gross amount,
        // so scale it down to the net before deriving the slippage floor.
        const feeRaw = feeOf(amountIn, chain.key);
        const netIn = amountIn - feeRaw;
        const expectedNet = (expectedOutRaw * netIn) / amountIn;
        const minOut = (expectedNet * (BPS - BigInt(slippageBps))) / BPS;

        // The wallet and its smart account are readied before anything is built: a Binance route
        // through a market maker fills for only seconds after its build (lib/server/binanceLegs.ts).
        const provider = asViemProvider(await wallet.getEthereumProvider());
        await getSmartAccountClient(provider, chain);
        const buildCalls = async (): Promise<{ calls: Call[]; dryRun?: DryRun }> => {
          let calls: Call[];
          let dryRun: DryRun | undefined;
          const route = chain.routes[asset.symbol];
          if (asset.via === "aave_v3") {
            // Safe dollars: supply USDC to Aave, aUSDC lands in the user's account 1:1.
            const pool = chain.routers.aavePool!;
            calls = [
              approve(usdc, pool, netIn),
              {
                to: pool,
                data: encodeFunctionData({ abi: AAVE_POOL_ABI, functionName: "supply", args: [usdc, netIn, recipient, 0] }),
              },
            ];
          } else if (usesAggregator(chain, asset)) {
            // Kyber builds the swap for the NET amount; its minReturn + our quote floor both
            // derive from the user's slippage pick. Fee transfer is prepended below as usual.
            const agg = await aggregatorCalls(chain, {
              asset,
              side: "buy",
              tokenIn: usdc,
              amountIn: netIn,
              account: recipient,
              slippageBps,
              reviewedMinOut: minOut,
              venue,
            });
            calls = agg.calls;
            dryRun = agg.dryRun;
          } else if (route) {
            // Multi-hop exactInput(path) has no per-hop price limit; minOut guards it alone.
            calls = [approve(usdc, route.router, netIn), routeSwapCall(chain, asset.symbol, route.hops, recipient, netIn, minOut)];
          } else {
            // Single-hop gets a price-impact ceiling on top of the minOut floor.
            const sqrtPriceLimitX96 = await singleHopSqrtLimit(chain, asset.pool!, usdc);
            calls = [
              approve(usdc, chain.routers.v3, netIn),
              singleHopSwapCall(chain, {
                tokenIn: usdc,
                tokenOut: assetAddress,
                fee: asset.feeTier ?? 3000,
                recipient,
                amountIn: netIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96,
              }),
            ];
          }

          // Fee transfer (if any) goes first, batched into the same sponsored UserOp.
          if (feeRaw > BigInt(0)) {
            calls.unshift({
              to: usdc,
              data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, feeRaw] }),
            });
          }
          return { calls, dryRun };
        };

        setPhase("swapping");
        const { receipt, built } = await sendBuiltCalls(provider, chain, buildCalls, usesAggregator(chain, asset) ? AGGREGATOR_RESENDS : 0);
        const dryRun = built.dryRun;
        setResult({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          asset,
          amountUsd,
          side: "buy",
          ...(dryRun ? { dryRun } : {}),
        });
        setPhase("done");
        refreshBalances(); // cash + holdings refetch now
      } catch (e) {
        setError(e instanceof Error ? e.message : "The buy didn't go through.");
        setErrorCause(e);
        setPhase("error");
      }
    },
    [activeWallet, chain, demo, refreshBalances],
  );

  /**
   * Sell `amountIn` raw units of a held `asset` back to USDC as one sponsored
   * UserOp. Routed assets sell through their route in REVERSE; Aave safe dollars
   * withdraw straight from the pool (no approval needed). recipient = user.
   * `minUsdcOut` is the slippage-guarded floor (raw 6dp).
   */
  const sell = useCallback(
    async (params: {
      asset: Asset;
      amountIn: bigint; // raw units of the held token
      minUsdcOut: bigint; // raw 6dp USDC floor
      estUsdcValue: number; // for the receipt headline
      recipient: string;
      /** Slippage the aggregator should enforce (Base); defaults to 1%. */
      slippageBps?: number;
      /** BSC only: which issuer actually holds this position (a twin holding sells its own
       *  token, not the ticker's default address). Ignored elsewhere. */
      venue?: RwaPlatform;
    }) => {
      const { asset, amountIn, minUsdcOut, estUsdcValue, recipient: rcpt, venue } = params;
      const slippageBps = params.slippageBps ?? 100;
      const recipient = rcpt as `0x${string}`;
      setError(null);
      setErrorCause(null);
      setResult(null);
      // Demo mode: simulate a successful sell without ever touching the chain.
      if (demo) {
        setPhase("swapping");
        await sleep(1400);
        if (demo.rwa) {
          try {
            const q = demo.quote({ asset, side: "sell", amountIn, venue });
            const usd = Number(q.amountOut) / 1e18;
            const qty = Number(amountIn) / 10 ** (asset.decimals ?? 18);
            const txHash = demo.recordTrade({ side: "sell", symbol: asset.symbol, venue, usd, qty });
            setResult({ txHash, asset, amountUsd: usd, side: "sell", dryRun: q.dryRun });
            setPhase("done");
          } catch (e) {
            setError(e instanceof Error ? e.message : "The sell didn't go through.");
            setErrorCause(e);
            setPhase("error");
          }
          return;
        }
        setResult({ txHash: DEMO_SWAP_TX, asset, amountUsd: estUsdcValue, side: "sell" });
        setPhase("done");
        return;
      }
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        const route = chain.routes[asset.symbol];
        const aggregator = usesAggregator(chain, asset);
        const sellable =
          asset.address && (asset.via === "aave_v3" ? Boolean(chain.routers.aavePool) : aggregator || asset.pool || route);
        if (!sellable) throw new Error(`${asset.symbol} can't be sold here yet.`);
        if (amountIn <= BigInt(0)) throw new Error("Nothing to sell.");
        // A twin holding (e.g. NVDAon when the default is bStock's NVDAB) sells its OWN token,
        // never the ticker's default address — resolveVenueAddress is the same rule the
        // portfolio rows and the buy quote use, so a sell can't approve the wrong contract.
        const venueToken = resolveVenueAddress(chain, asset, venue);
        if (!venueToken) throw new Error(`Couldn't find ${asset.symbol} for that venue.`);

        const usdc = chain.usdc.address;
        const provider = asViemProvider(await wallet.getEthereumProvider());
        await getSmartAccountClient(provider, chain);
        const buildCalls = async (): Promise<{ calls: Call[]; dryRun?: DryRun }> => {
          let calls: Call[];
          let dryRun: DryRun | undefined;
          if (asset.via === "aave_v3") {
            // aUSDC balance is the USDC amount (1:1, 6 dec); withdraw burns it from the caller.
            calls = [
              {
                to: chain.routers.aavePool!,
                data: encodeFunctionData({ abi: AAVE_POOL_ABI, functionName: "withdraw", args: [usdc, amountIn, recipient] }),
              },
            ];
          } else if (aggregator) {
            const agg = await aggregatorCalls(chain, {
              asset,
              side: "sell",
              tokenIn: venueToken.address,
              amountIn,
              account: recipient,
              slippageBps,
              reviewedMinOut: minUsdcOut,
              venue,
            });
            calls = agg.calls;
            dryRun = agg.dryRun;
          } else if (route) {
            calls = [
              approve(asset.address!, route.router, amountIn),
              routeSwapCall(chain, asset.symbol, reverseRoute(route.hops), recipient, amountIn, minUsdcOut),
            ];
          } else {
            const sqrtPriceLimitX96 = await singleHopSqrtLimit(chain, asset.pool!, asset.address!);
            calls = [
              approve(asset.address!, chain.routers.v3, amountIn),
              singleHopSwapCall(chain, {
                tokenIn: asset.address!,
                tokenOut: usdc,
                fee: asset.feeTier ?? 3000,
                recipient,
                amountIn,
                amountOutMinimum: minUsdcOut,
                sqrtPriceLimitX96,
              }),
            ];
          }
          return { calls, dryRun };
        };

        setPhase("swapping");
        const { receipt, built } = await sendBuiltCalls(provider, chain, buildCalls, aggregator ? AGGREGATOR_RESENDS : 0);
        const dryRun = built.dryRun;
        setResult({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          asset,
          amountUsd: estUsdcValue,
          side: "sell",
          ...(dryRun ? { dryRun } : {}),
        });
        setPhase("done");
        refreshBalances(); // cash + holdings refetch now
      } catch (e) {
        setError(e instanceof Error ? e.message : "The sell didn't go through.");
        setErrorCause(e);
        setPhase("error");
      }
    },
    [activeWallet, chain, demo, refreshBalances],
  );

  return { phase, error, errorCause, result, busy: phase === "swapping", buy, sell, reset };
}
