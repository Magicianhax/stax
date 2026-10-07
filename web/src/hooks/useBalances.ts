"use client";

// Money reads (chain-aware).
//
//   useUsdcBalance(address)   -> spendable dollars (USDC, 6dp; one batched RPC read)
//   usePortfolio(address)     -> fully-valued holdings from /api/portfolio
//
// The portfolio is computed SERVER-SIDE (one multicall + cached DEX-pool prices
// + real 1D market moves) and rendered verbatim here — the browser does no
// balance fan-out and no qty×price math. That keeps RPC traffic to ~one request
// per poll and makes every screen agree on the same numbers.
//
// Every query is keyed by the active chain, so switching networks in Settings
// refetches against the right USDC / asset set (and never mixes the two).
import { useCallback } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { getPublicClient } from "@/lib/wagmi";
import { ERC20_ABI } from "@/lib/abis";
import { assetBySymbol, type Asset, type RwaPlatform, type StaxChain } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { authedFetch } from "@/lib/authedFetch";
import { fromUnits } from "@/lib/format";
import { useDemo } from "@/components/demo/DemoProvider";

// Shared freshness policy for money reads: poll on a calm interval AND refetch
// when the user returns to the tab / reconnects / re-mounts a screen, so a
// deposit or action shows up without a manual page refresh. Writes invalidate
// immediately via useRefreshBalances, so the poll is only a safety net.
const LIVE_BALANCE_OPTS = {
  staleTime: 15_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchOnMount: "always",
  // Keep the last value on screen across refetches / address changes, so the
  // balance never blanks out mid-update.
  placeholderData: keepPreviousData,
} as const;

export interface Holding {
  asset: Asset;
  raw: bigint;
  qty: number;
  /** USD value, or undefined if unpriced. */
  valueUsd?: number;
  priceUsd?: number;
  /** Real 1D market move (%), or undefined if no live source. */
  dayChangePct?: number;
  /** Real 1D sparkline for row charts. */
  spark?: number[];
  /** BSC only: which issuer minted this row's tokens — a ticker can appear twice, once per
   *  venue, when the user holds both bStock's and Ondo's mint of the same stock. Undefined on
   *  every Base/Mantle holding. */
  venue?: RwaPlatform;
}

export interface Portfolio {
  holdings: Holding[];
  /** Sum of priced holdings (USD). */
  investedUsd: number;
  /** Spendable USDC (USD). */
  cashUsd: number;
  /** BSC only: money in Savings (Venus), counted in totalUsd but not in investedUsd. */
  savingsUsd?: number;
  /** investedUsd + cashUsd + savingsUsd — the headline number, computed server-side. */
  totalUsd: number;
}

/** Spendable USDC balance (number, dollars) on the active chain. */
export function useUsdcBalance(address?: string) {
  const demo = useDemo();
  const chain = useChain();
  const query = useQuery({
    queryKey: ["usdc-balance", chain.key, address],
    enabled: !demo && Boolean(address),
    refetchInterval: 30_000,
    ...LIVE_BALANCE_OPTS,
    queryFn: async (): Promise<{ raw: bigint; value: number }> => {
      const raw = (await getPublicClient(chain).readContract({
        address: chain.usdc.address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })) as bigint;
      return { raw, value: fromUnits(raw, chain.usdc.decimals) };
    },
  });
  if (demo) return { ...query, data: demo.usdc, isLoading: false, isPending: false } as typeof query;
  return query;
}

interface PortfolioApiHolding {
  symbol: string;
  raw: string;
  qty: number;
  priceUsd: number | null;
  valueUsd: number | null;
  dayChangePct: number | null;
  spark: number[] | null;
  venue?: RwaPlatform;
}

interface PortfolioApiResponse {
  cashUsd: number;
  investedUsd: number;
  totalUsd: number;
  savingsUsd?: number;
  holdings: PortfolioApiHolding[];
}

// Set by useRefreshBalances: until this instant the portfolio reads ask the server to skip its
// per-address balance cache (BSC), so a trade or Savings move shows up in the balances right away.
let freshUntilMs = 0;
const FRESH_WINDOW_MS = 6_000;

/** The user's holdings on the active chain, valued server-side. See /api/portfolio. */
export function usePortfolio(address?: string) {
  const demo = useDemo();
  const chain = useChain();
  const query = useQuery({
    queryKey: ["portfolio", chain.key, address],
    enabled: !demo && Boolean(address),
    refetchInterval: 30_000,
    ...LIVE_BALANCE_OPTS,
    queryFn: async (): Promise<Portfolio> => {
      // After the person's own write the next read bypasses the server's balance cache.
      const res = await authedFetch(`/api/portfolio?address=${address}${Date.now() < freshUntilMs ? "&fresh=1" : ""}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load portfolio.");
      }
      const api = json as PortfolioApiResponse;
      const holdings: Holding[] = [];
      for (const h of api.holdings) {
        const asset = assetBySymbol(chain, h.symbol);
        if (!asset) continue;
        holdings.push({
          asset,
          // Raw units in the asset's own decimals (Base stocks 8, aBasUSDC 6, Mantle xStocks 18) —
          // or, for a twin row, the twin's own decimals; the server already sized `raw` correctly.
          raw: BigInt(h.raw),
          qty: h.qty,
          valueUsd: h.valueUsd ?? undefined,
          priceUsd: h.priceUsd ?? undefined,
          dayChangePct: h.dayChangePct ?? undefined,
          spark: h.spark ?? undefined,
          venue: h.venue,
        });
      }
      return {
        holdings,
        investedUsd: api.investedUsd,
        cashUsd: api.cashUsd,
        totalUsd: api.totalUsd,
        savingsUsd: api.savingsUsd,
      };
    },
  });
  if (demo) return { ...query, data: demo.portfolio, isLoading: false, isPending: false } as typeof query;
  return query;
}

/** True if `symbol` is a stock-tier asset on `chain` (not necessarily routable yet — see isRoutable). */
export function isBuyableStock(chain: StaxChain, symbol: string): boolean {
  return chain.assets.stocks.some((s) => s.symbol === symbol);
}

/**
 * Returns a function that invalidates the money queries (cash, portfolio,
 * activity) so they refetch immediately. Call it right after any successful
 * on-chain write — invest, buy/sell, send — so the UI reflects the new balance
 * without waiting for the poll interval or a manual page refresh.
 */
export function useRefreshBalances() {
  const qc = useQueryClient();
  return useCallback(() => {
    freshUntilMs = Date.now() + FRESH_WINDOW_MS;
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["usdc-balance"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    };
    invalidate();
    // The read RPC can trail the bundler by a block right after inclusion, so a
    // second pass a moment later catches the settled state.
    setTimeout(invalidate, 2500);
  }, [qc]);
}
