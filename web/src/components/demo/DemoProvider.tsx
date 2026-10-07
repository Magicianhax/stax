"use client";

// DemoProvider — wraps the REAL Stax app so its hooks return demo values instead of touching
// auth, a chain, Binance or an AI. The hooks (useSmartAccount, useBalances, useActivity, useInvest,
// useSwap, useRwa, useSpread, useEarnings, useSavings, useQuote ...) each read this context and
// short-circuit when present; when absent (the entire production app) they behave exactly as
// before. The demo never signs, sends, or calls Binance.
//
// It runs on BNB Chain, the app's default network (lib/demo/bscWorld.ts). Base stays reachable
// because gifts exist only there: opening one from the demo switches to the Base demo world, the
// same way the real app switches networks. What the visitor does in a session (a buy, a basket, a
// Savings move) is kept in memory as `fills` and shown everywhere; a reload starts over.
//
// `play` selects an auto-played script for embedded previews:
//   null     → fully interactive (/demo)
//   "invest" → loops the goal → plan → invest → success flow
//   "vera"   → loops Vera's build-and-sign story
//
// `market` pins the demo market: "live" follows the viewer's own clock (so a weekend shows a
// closed market, which is the point of the product), "open" and "closed" show either state on
// demand so both stories can be tried at any hour.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Asset, RwaPlatform } from "@/lib/chains";
import type { ChainKey } from "@/lib/chains/types";
import { pinDemoChain, unpinDemoChain, useChain } from "@/lib/chains/active";
import type { AllocateResult, InvestSuccess } from "@/lib/invest-types";
import type { Allocation } from "@/lib/allocation-schema";
import type { DryRun } from "@/lib/dryRun";
import { demoAllocate, demoSuccess } from "@/lib/demo/demoData";
import { demoBscAllocate, demoBscDryRuns, demoBscPlanFills, demoBscSuccess, demoTxHash } from "@/lib/demo/bscVera";
import { demoClock, demoQuote, type DemoMarketMode, type DemoQuote } from "@/lib/demo/bscMarket";
import { demoWorldFor } from "@/lib/demo/world";
import type { DemoFill, DemoWorld } from "@/lib/demo/demoTypes";

export type DemoPlay = "invest" | "vera" | null;
export type { DemoMarketMode };

export interface DemoApi extends DemoWorld {
  play: DemoPlay;
  /** Which market the demo is showing: the viewer's own clock, or pinned open or closed. */
  marketMode: DemoMarketMode;
  setMarketMode: (mode: DemoMarketMode) => void;
  /** Vera's plan for a goal (throws DemoRefusal, worded for the person, when she won't). */
  allocate: (goal: string, amountUsd: number, risk?: string) => AllocateResult;
  /** Placing a plan: Binance's checks on each stock, the receipt, and the holdings it leaves behind. */
  placePlan: (alloc: Allocation, amountUsd: number) => { success: InvestSuccess; dryRuns?: DryRun[] };
  /** BNB Chain only: a trade quote with the real refusals (market closed, under $6), and a passed Binance check. */
  quote: (args: { asset: Asset; side: "buy" | "sell"; amountIn: bigint; venue?: RwaPlatform }) => DemoQuote;
  /** Record a simulated buy or sell so Home, Owned and the wallet show it. Returns its fake transaction hash. */
  recordTrade: (t: { side: "buy" | "sell"; symbol: string; venue?: RwaPlatform; usd: number; qty: number }) => `0x${string}`;
  /** Record a simulated Savings move (positive in, negative out). Returns its fake transaction hash. */
  recordSavings: (usd: number) => `0x${string}`;
}

interface DemoContextValue {
  apis: Record<"bsc" | "base", DemoApi>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

/** Demo overrides for the active network when mounted under <DemoProvider>, else null (production). */
export function useDemo(): DemoApi | null {
  const ctx = useContext(DemoContext);
  const chain = useChain();
  if (!ctx) return null;
  return ctx.apis[chain.key === "bsc" ? "bsc" : "base"];
}

export function DemoProvider({
  play = null,
  market = "live",
  children,
}: {
  play?: DemoPlay;
  market?: DemoMarketMode;
  children: ReactNode;
}) {
  // Invariant: demo overrides are for the marketing landing + /demo ONLY. They
  // must NEVER wrap the real signed-in app (/app), or a real user could be routed
  // through mock (no-op) transactions that show fake success. Trip loudly in dev
  // if that ever happens so a misplaced provider is caught immediately.
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/app")
    ) {
      console.error("[DemoProvider] mounted on /app — the real app must never run under demo overrides.");
    }
  }, []);

  // BNB Chain is the demo's network. Pinned in an effect (a counted pin: two demos on one page
  // can't unpin each other, and server rendering never touches module state) and released when
  // the demo unmounts. Before the effect runs the app's default network, BNB Chain, is what renders.
  useEffect(() => {
    pinDemoChain("bsc");
    return () => unpinDemoChain();
  }, []);

  const [mode, setMode] = useState<DemoMarketMode>(market);
  const [realNow] = useState(() => Date.now());
  const [fills, setFills] = useState<DemoFill[]>([]);
  const seq = useRef(0);

  const nowMs = useMemo(() => demoClock(mode, realNow), [mode, realNow]);

  const record = useCallback((added: DemoFill[]) => setFills((f) => [...f, ...added]), []);
  const nextHash = useCallback(() => demoTxHash(++seq.current), []);

  const apis = useMemo<Record<"bsc" | "base", DemoApi>>(() => {
    const make = (key: ChainKey): DemoApi => {
      const world = demoWorldFor(key, { nowMs, fills });
      const bsc = key === "bsc";
      return {
        ...world,
        play,
        marketMode: mode,
        setMarketMode: setMode,
        allocate: (goal, amountUsd, risk) =>
          bsc && world.rwa
            ? demoBscAllocate({ goal, amountUsd, risk, rwa: world.rwa, nowMs })
            : demoAllocate(goal, amountUsd, risk),
        placePlan: (alloc, amountUsd) => {
          const txHash = nextHash();
          if (bsc && world.rwa) {
            record(demoBscPlanFills(alloc, amountUsd, world.rwa, txHash));
            return { success: demoBscSuccess(alloc, amountUsd, txHash), dryRuns: demoBscDryRuns(alloc, amountUsd, world.rwa, nowMs) };
          }
          return { success: demoSuccess(alloc, amountUsd) };
        },
        quote: ({ asset, side, amountIn, venue }) => {
          if (!world.rwa) throw new Error("The demo only quotes trades on BNB Chain.");
          return demoQuote({ asset, side, amountIn, venue, rwa: world.rwa, nowMs });
        },
        recordTrade: (t) => {
          const txHash = nextHash();
          if (bsc) record([{ kind: "trade", ...t, txHash }]);
          return txHash;
        },
        recordSavings: (usd) => {
          const txHash = nextHash();
          if (bsc) record([{ kind: "save", usd, txHash }]);
          return txHash;
        },
      };
    };
    return { bsc: make("bsc"), base: make("base") };
  }, [nowMs, fills, play, mode, record, nextHash]);

  const value = useMemo<DemoContextValue>(() => ({ apis }), [apis]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
