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
import { sendSponsoredCalls, type Call } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { AAVE_POOL_ABI, AGNI_ROUTER_ABI, ERC20_ABI, FLUXION_ROUTER_ABI, UNISWAP_ROUTER02_ABI } from "@/lib/abis";
import { isRoutable, reverseRoute, type Asset, type RouteHop, type StaxChain } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { encodeV3Path, singleHopSqrtLimit } from "@/lib/swapRouting";
import { fetchSwapQuote, usesAggregator } from "@/lib/swapQuote";
import { feeOf, STAX_TREASURY } from "@/lib/fees";

type Phase = "idle" | "swapping" | "done" | "error";

const BPS = BigInt(10000);
const DEADLINE_SECONDS = 15 * 60;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Canned receipt hash for demo-mode buys/sells (never broadcast on-chain).
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
 * Aggregator swap: [ approve(kyberRouter, amountIn), router.swap(data) ]. The calldata is
 * built server-side for sender = recipient = `account` and is only good for ~10s, so this
 * runs immediately before sendSponsoredCalls. The router must be the one the chain config
 * (and the executor whitelist) names — anything else is refused.
 */
async function aggregatorCalls(
  chain: StaxChain,
  p: { symbol: string; side: "buy" | "sell"; tokenIn: `0x${string}`; amountIn: bigint; account: `0x${string}`; slippageBps: number },
): Promise<{ calls: Call[]; minOut: bigint }> {
  const q = await fetchSwapQuote({
    symbol: p.symbol,
    side: p.side,
    amountIn: p.amountIn,
    sender: p.account,
    recipient: p.account,
    slippageBps: p.slippageBps,
    build: true,
  });
  const router = chain.routers.kyber!;
  if (q.router.toLowerCase() !== router.toLowerCase() || !q.data) {
    throw new Error("The swap route didn't match this network. Please try again.");
  }
  if (q.amountIn !== p.amountIn) throw new Error("The swap amount changed. Please try again.");
  return { calls: [approve(p.tokenIn, router, p.amountIn), { to: router, data: q.data }], minOut: q.minOut };
}

export interface SwapResult {
  txHash: `0x${string}`;
  asset: Asset;
  amountUsd: number;
  /** "buy" (USDC -> asset) or "sell" (asset -> USDC). */
  side: "buy" | "sell";
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
  const [result, setResult] = useState<SwapResult | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
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
    }) => {
      const { asset, amountUsd, expectedOutRaw, slippageBps, recipient: rcpt } = params;
      const recipient = rcpt as `0x${string}`;
      setError(null);
      setResult(null);
      // Demo mode: simulate a successful buy without ever touching the chain.
      if (demo) {
        setPhase("swapping");
        await sleep(1400);
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

        const usdc = chain.usdc.address;
        const amountIn = BigInt(Math.round(amountUsd * 1_000_000));
        if (amountIn <= BigInt(0)) throw new Error("Enter an amount first.");
        // Platform fee skimmed to the treasury (gasless, batched below); the rest
        // is what we actually swap. expectedOutRaw was quoted for the gross amount,
        // so scale it down to the net before deriving the slippage floor.
        const feeRaw = feeOf(amountIn);
        const netIn = amountIn - feeRaw;
        const expectedNet = (expectedOutRaw * netIn) / amountIn;
        const minOut = (expectedNet * (BPS - BigInt(slippageBps))) / BPS;

        let calls: Call[];
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
            symbol: asset.symbol,
            side: "buy",
            tokenIn: usdc,
            amountIn: netIn,
            account: recipient,
            slippageBps,
          });
          if (agg.minOut < minOut / BigInt(2)) {
            throw new Error("The price moved too much since your quote. Please try again.");
          }
          calls = agg.calls;
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
              tokenOut: asset.address,
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

        setPhase("swapping");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const receipt = await sendSponsoredCalls(provider, calls, chain);
        setResult({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          asset,
          amountUsd,
          side: "buy",
        });
        setPhase("done");
        refreshBalances(); // cash + holdings refetch now
      } catch (e) {
        setError(e instanceof Error ? e.message : "The buy didn't go through.");
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
    }) => {
      const { asset, amountIn, minUsdcOut, estUsdcValue, recipient: rcpt } = params;
      const slippageBps = params.slippageBps ?? 100;
      const recipient = rcpt as `0x${string}`;
      setError(null);
      setResult(null);
      // Demo mode: simulate a successful sell without ever touching the chain.
      if (demo) {
        setPhase("swapping");
        await sleep(1400);
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

        const usdc = chain.usdc.address;
        let calls: Call[];
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
            symbol: asset.symbol,
            side: "sell",
            tokenIn: asset.address!,
            amountIn,
            account: recipient,
            slippageBps,
          });
          if (agg.minOut < minUsdcOut / BigInt(2)) {
            throw new Error("The price moved too much since your quote. Please try again.");
          }
          calls = agg.calls;
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

        setPhase("swapping");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const receipt = await sendSponsoredCalls(provider, calls, chain);
        setResult({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          asset,
          amountUsd: estUsdcValue,
          side: "sell",
        });
        setPhase("done");
        refreshBalances(); // cash + holdings refetch now
      } catch (e) {
        setError(e instanceof Error ? e.message : "The sell didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, chain, demo, refreshBalances],
  );

  return { phase, error, result, busy: phase === "swapping", buy, sell, reset };
}
