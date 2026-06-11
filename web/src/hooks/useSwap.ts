"use client";

// useSwap — Pro manual buy: a direct, gasless Fluxion swap.
//
// Two batched calls, sent as one sponsored UserOp:
//   [ USDC.approve(router, amountIn),
//     router.exactInputSingle({ ..., recipient: USER }) ]
//
// Unlike the AI invest flow (which routes through StaxExecutor), here the
// smart account swaps directly and the bought tokens land in the user's account.
import { useCallback, useState } from "react";
import { concatHex, encodeFunctionData, numberToHex } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls, type Call } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { AGNI_ROUTER_ABI, ERC20_ABI, FLUXION_ROUTER_ABI, V3_POOL_ABI } from "@/lib/abis";
import { USDC, FLUXION_ROUTER, ASSET_ROUTES, reverseRoute, type Asset, type RouteHop } from "@/lib/mantle";
import { publicClient } from "@/lib/wagmi";
import { priceLimitSqrtX96 } from "@/lib/swapGuards";
import { feeOf, STAX_TREASURY } from "@/lib/fees";

type Phase = "idle" | "swapping" | "done" | "error";

const BPS = BigInt(10000);
const DEADLINE_SECONDS = 15 * 60;

/**
 * Best-effort price-impact ceiling for a single-hop Fluxion swap. Reads the
 * pool's current price; on any failure returns 0n (no limit — today's behavior),
 * so this can never make a swap worse than before. amountOutMinimum stays the
 * precise floor (see swapGuards.ts).
 */
async function singleHopSqrtLimit(pool: `0x${string}`, tokenIn: `0x${string}`): Promise<bigint> {
  try {
    const [slot0, token0] = await Promise.all([
      publicClient.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "slot0" }),
      publicClient.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "token0" }),
    ]);
    const sqrtPriceX96 = (slot0 as readonly bigint[])[0];
    const zeroForOne = (token0 as string).toLowerCase() === tokenIn.toLowerCase();
    return priceLimitSqrtX96(sqrtPriceX96, zeroForOne);
  } catch {
    return BigInt(0);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Canned receipt hash for demo-mode buys/sells (never broadcast on-chain).
const DEMO_SWAP_TX = ("0x" + "5a7c2b41".repeat(32).slice(0, 64)) as `0x${string}`;

/** Encode a Uniswap/Agni V3 `exactInput` path: token + fee(3b) + token + ... */
function encodeV3Path(hops: RouteHop[]): `0x${string}` {
  const parts: `0x${string}`[] = [hops[0].tokenIn];
  for (const h of hops) {
    parts.push(numberToHex(h.fee, { size: 3 }));
    parts.push(h.tokenOut);
  }
  return concatHex(parts);
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
      const { asset, amountUsd, expectedOutRaw, slippageBps, recipient } = params;
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
        if (!asset.address) throw new Error(`${asset.symbol} isn't buyable yet.`);

        const amountIn = BigInt(Math.round(amountUsd * 1_000_000));
        if (amountIn <= BigInt(0)) throw new Error("Enter an amount first.");
        // Platform fee skimmed to the treasury (gasless, batched below); the rest
        // is what we actually swap. expectedOutRaw was quoted for the gross amount,
        // so scale it down to the net before deriving the slippage floor.
        const feeRaw = feeOf(amountIn);
        const netIn = amountIn - feeRaw;
        const expectedNet = (expectedOutRaw * netIn) / amountIn;
        const minOut = (expectedNet * (BPS - BigInt(slippageBps))) / BPS;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

        // Routed SAFE/CRYPTO assets (sUSDe/mETH) buy via Agni exactInput(path);
        // stocks buy via the Fluxion single-hop. recipient = user in both cases.
        const route = ASSET_ROUTES[asset.symbol];
        const router = route ? route.router : (FLUXION_ROUTER as `0x${string}`);
        // Single-hop (Fluxion) gets a price-impact ceiling; the multi-hop Agni
        // exactInput(path) has no per-hop limit param, so minOut guards it alone.
        const sqrtLimit = route || !asset.pool ? BigInt(0) : await singleHopSqrtLimit(asset.pool, USDC.address as `0x${string}`);

        const approveCall: Call = {
          to: USDC.address as `0x${string}`,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [router, netIn],
          }),
        };
        const swapCall: Call = route
          ? {
              to: router,
              data: encodeFunctionData({
                abi: AGNI_ROUTER_ABI,
                functionName: "exactInput",
                args: [
                  {
                    path: encodeV3Path(route.hops),
                    recipient: recipient as `0x${string}`,
                    deadline,
                    amountIn: netIn,
                    amountOutMinimum: minOut,
                  },
                ],
              }),
            }
          : {
              to: router,
              data: encodeFunctionData({
                abi: FLUXION_ROUTER_ABI,
                functionName: "exactInputSingle",
                args: [
                  {
                    tokenIn: USDC.address as `0x${string}`,
                    tokenOut: asset.address,
                    fee: asset.feeTier ?? 3000,
                    recipient: recipient as `0x${string}`,
                    deadline,
                    amountIn: netIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: sqrtLimit,
                  },
                ],
              }),
            };

        // Fee transfer (if any) goes first, batched into the same sponsored UserOp.
        const feeCall: Call | null = feeRaw > BigInt(0)
          ? { to: USDC.address as `0x${string}`, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [STAX_TREASURY, feeRaw] }) }
          : null;

        setPhase("swapping");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const receipt = await sendSponsoredCalls(provider, feeCall ? [feeCall, approveCall, swapCall] : [approveCall, swapCall]);
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
    [activeWallet, demo, refreshBalances],
  );

  /**
   * Sell `amountIn` raw units of a held `asset` back to USDC, batched as one
   * sponsored UserOp: [ asset.approve(router, amountIn), router.swap ].
   * Stocks sell through their Fluxion pool (exactInputSingle); routed
   * SAFE/CRYPTO assets (sUSDe/mETH) sell through their validated Agni route in
   * REVERSE (exactInput, asset -> ... -> USDC). recipient = user in both cases.
   * `minUsdcOut` is the slippage-guarded floor (raw 6dp).
   */
  const sell = useCallback(
    async (params: {
      asset: Asset;
      amountIn: bigint; // raw units of the held token
      minUsdcOut: bigint; // raw 6dp USDC floor
      estUsdcValue: number; // for the receipt headline
      recipient: string;
    }) => {
      const { asset, amountIn, minUsdcOut, estUsdcValue, recipient } = params;
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
        const route = ASSET_ROUTES[asset.symbol];
        if (!asset.address || (!asset.pool && !route))
          throw new Error(`${asset.symbol} can't be sold here yet.`);
        if (amountIn <= BigInt(0)) throw new Error("Nothing to sell.");

        const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
        const router = route ? route.router : (FLUXION_ROUTER as `0x${string}`);
        // Single-hop (Fluxion) gets a price-impact ceiling on top of the
        // minUsdcOut floor; the multi-hop Agni exactInput(path) has no per-hop
        // limit param, so minUsdcOut guards it alone (same as the buy side).
        const sqrtLimit = route ? BigInt(0) : await singleHopSqrtLimit(asset.pool!, asset.address);

        const approveCall: Call = {
          to: asset.address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [router, amountIn],
          }),
        };
        const swapCall: Call = route
          ? {
              to: router,
              data: encodeFunctionData({
                abi: AGNI_ROUTER_ABI,
                functionName: "exactInput",
                args: [
                  {
                    path: encodeV3Path(reverseRoute(route.hops)),
                    recipient: recipient as `0x${string}`,
                    deadline,
                    amountIn,
                    amountOutMinimum: minUsdcOut,
                  },
                ],
              }),
            }
          : {
              to: router,
              data: encodeFunctionData({
                abi: FLUXION_ROUTER_ABI,
                functionName: "exactInputSingle",
                args: [
                  {
                    tokenIn: asset.address,
                    tokenOut: USDC.address as `0x${string}`,
                    fee: asset.feeTier ?? 3000,
                    recipient: recipient as `0x${string}`,
                    deadline,
                    amountIn,
                    amountOutMinimum: minUsdcOut,
                    sqrtPriceLimitX96: sqrtLimit,
                  },
                ],
              }),
            };

        setPhase("swapping");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const receipt = await sendSponsoredCalls(provider, [approveCall, swapCall]);
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
    [activeWallet, demo, refreshBalances],
  );

  return { phase, error, result, busy: phase === "swapping", buy, sell, reset };
}
