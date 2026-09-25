"use client";
import type { ActivityLeg } from "@/lib/onchainHistory";

// Stax app shell — a small screen router that mirrors the design's go(screen,
// params) orchestrator (app.jsx) while wiring the REAL hooks end to end.
//
// Invest loop (Vera):
//   home → goal → thinking → plan → placing → success
//   • goal "Build my plan"  -> useInvest.allocate (POST /api/allocate)
//   • plan nudge chips        -> re-run allocate() with an adjusted riskTolerance
//   • plan "Invest $X · free" -> useInvest.invest (POST /api/invest-plan +
//                                sendSponsoredCalls); <Placing> follows real phase
//   • success                 -> confetti + holdings + on-chain receipt (chain explorer)
//
// Browse / own / trade (Pro depth, always available here):
//   portfolio · market → asset → trade → receipt · activity · wallet
//
// Tabs: home · market · [invest → hub] · portfolio · wallet. The centre button
// opens `hub`, a short menu of everything Vera can do; each item is its own screen.
//
// Navigation keeps a small history stack so go(-1) returns to the prior screen.
// The bottom TabBar lives here (the design owns its own chrome).
import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { useInvest } from "@/hooks/useInvest";
import { useSwap } from "@/hooks/useSwap";
import { usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useChainKey } from "@/lib/chains/active";
import { giftContractFor } from "@/lib/gifts";
import { haptic } from "@/lib/haptics";
import { TabBar, type TabId, useToast } from "@/components/design";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { useDemo } from "@/components/demo/DemoProvider";
import { useBetaAccess, isBetaOn } from "@/hooks/useBetaAccess";
import { LoadingScreen } from "@/components/shared/AppShell";
import { BetaGateScreen } from "./screens/BetaGateScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { GoalScreen } from "./screens/GoalScreen";
import { ThinkingScreen } from "./screens/ThinkingScreen";
import { PlanScreen } from "./screens/PlanScreen";
import { PlacingScreen } from "./screens/PlacingScreen";
import { SuccessScreen } from "./screens/SuccessScreen";
import { PortfolioScreen } from "./screens/PortfolioScreen";
import { MarketScreen } from "./screens/MarketScreen";
import { AssetDetailScreen } from "./screens/AssetDetailScreen";
import { TradeScreen } from "./screens/TradeScreen";
import { ReceiptScreen } from "./screens/ReceiptScreen";
import { HubScreen } from "./screens/HubScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ActivityScreen } from "./screens/ActivityScreen";
import { HelpScreen } from "./screens/HelpScreen";
import { WalletScreen } from "./screens/WalletScreen";
import { SendScreen } from "./screens/SendScreen";
import { AutopilotScreen } from "./screens/AutopilotScreen";
import { BasketsScreen } from "./screens/BasketsScreen";
import { BasketDetailScreen } from "./screens/BasketDetailScreen";
import { IssuerBoardScreen } from "./screens/IssuerBoardScreen";
// ── gift-ui ─────────────────────────────────────────────────────────────────
import { GiftScreen } from "./screens/GiftScreen";
import { GiftViewScreen } from "./screens/GiftViewScreen";
// ── end gift-ui ─────────────────────────────────────────────────────────────
import { decodeBasketLink, type Basket, type DecodeResult } from "@/lib/baskets";
import { fetchSharedBasket } from "@/hooks/useBaskets";
import type { AllocateResult } from "@/lib/invest-types";
import { usd as formatUsd } from "@/lib/format";

type Screen =
  | "home"
  // The centre tab: a short menu of everything Vera can do, each on its own screen.
  | "hub"
  | "baskets"
  | "basket"
  | "issuers"
  // ── gift-ui: give a basket ("gift") and your gifts ("gifts") ──────────────
  | "gift"
  | "gifts"
  // ── end gift-ui ───────────────────────────────────────────────────────────
  | "wallet"
  | "send"
  | "autopilot"
  | "goal"
  | "thinking"
  | "plan"
  | "placing"
  | "success"
  | "portfolio"
  | "market"
  | "asset"
  | "trade"
  | "receipt"
  | "settings"
  | "activity"
  | "help";

type Tone = "balanced" | "safer" | "bolder" | "simple";
type Params = Record<string, unknown>;

interface Route {
  screen: Screen;
  params: Params;
}

// ── feel-trade: closing the loop ─────────────────────────────────────────────
// Route params that carry a finished trade/invest to its destination so the
// screen can acknowledge it: `home` → { loop?: LoopParams }; `asset` →
// { symbol: string; loop?: LoopParams }. Home/Owned/AssetDetail render
// `<Money prev={loop.prevCash}>` and `flashKey={`${symbol}:${loop.txHash}`}`.
export interface LoopParams {
  /** Symbols whose HoldingRow should flash once. */
  flash: string[];
  /** Tx hash of the trade / invest that just completed (keys the flash). */
  txHash: string;
  /** Cash balance before the trade (Money counts prevCash → cash). */
  prevCash?: number;
  /** Total balance before the trade (Money counts prevTotal → total). */
  prevTotal?: number;
}

/** A manual trade as it travels Trade → Placing → Receipt (`params.order`). */
export interface TradeOrder {
  side: "buy" | "sell";
  symbol: string;
  name: string;
  ticker: string;
  /** "shares" for stocks, else the ticker. */
  unit: string;
  /** Display quantity, e.g. "0.4303". */
  qty: string;
  priceUsd: number;
  feeUsd: number;
  /** Buy: total paid (fee included). Sell: what lands in cash. */
  amountUsd: number;
}

/** Trade form state restored when a trade bounces back with an error. */
export interface TradeDraft {
  amt: string;
  sellPct: number;
  tol: number;
}

/** Balances the moment Placing appeared (`params.before` on placing/success). */
interface Snapshot {
  cash?: number;
  total?: number;
}

/** Placing and Thinking stay up at least this long so they never flash. */
const DWELL_MS = 1200;
// ── end feel-trade types ─────────────────────────────────────────────────────

const TONE_RISK: Record<Tone, "conservative" | "balanced" | "aggressive"> = {
  balanced: "balanced",
  safer: "conservative",
  bolder: "aggressive",
  simple: "conservative",
};
const TONE_HINT: Record<Tone, string> = {
  balanced: "",
  safer: " (lean safer — protect my money first)",
  bolder: " (be bolder — I can handle bigger swings for more growth)",
  simple: " (keep it simple — just a couple of broad, easy holdings)",
};

// Which tab is highlighted for a given screen.
function tabFor(screen: Screen): TabId {
  if (screen === "portfolio" || screen === "asset") return "portfolio";
  if (screen === "market") return "market";
  if (screen === "hub") return "invest";
  if (screen === "wallet") return "wallet";
  return "home";
}

export function LiteApp({ demoPlay = null }: { demoPlay?: "invest" | "vera" | null }) {
  const invest = useInvest();
  const { address } = useSmartAccount();
  const { notify } = useToast();
  const demo = useDemo();
  // Private beta (docs/BETA.md): real mode only, never the demo. Resolved
  // after Privy auth; the splash holds until we know, then the gate replaces
  // the whole app unless the person is approved. Rendered below, after hooks.
  const beta = useBetaAccess();
  const gated = isBetaOn() && !demo;

  const [stack, setStack] = useState<Route[]>([{ screen: "home", params: {} }]);
  const current = stack[stack.length - 1];

  // Gifts live on Base only (ADR-0010), while BNB Chain is the default. Opening a gift screen, or
  // a `?gift=` link, on a chain without the gift contract switches to the one that has it.
  const [activeChainKey, setActiveChain] = useChainKey();
  useEffect(() => {
    if (current.screen !== "gift" && current.screen !== "gifts") return;
    if (giftContractFor(activeChainKey) || !giftContractFor("base")) return;
    setActiveChain("base");
  }, [current.screen, activeChainKey, setActiveChain]);
  const { screen, params } = current;

  const [goal, setGoal] = useState("");
  const [amount, setAmount] = useState(0);
  const [tone, setTone] = useState<Tone>("balanced");
  const [rethinking, setRethinking] = useState(false);
  // A basket's fixed-weight plan, reviewed on the same PlanScreen as Vera's own
  // plans and placed through the same invest() call. Cleared whenever home resets.
  const [basketPlan, setBasketPlan] = useState<{ allocation: AllocateResult; basket: Basket } | null>(null);
  const activeAllocation = basketPlan?.allocation ?? invest.allocation;

  // Navigation direction drives the screen transition (push / pop / fade).
  const [dir, setDir] = useState<"push" | "pop" | "fade">("fade");
  // Live edge-swipe-back drag offset.
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; active: boolean } | null>(null);

  // ── feel-trade: manual trades + closing the loop ────────────────────────────
  // The swap lives here (not in TradeScreen) so it survives the route change to
  // Placing. Balances are snapshotted into the placing route's params the moment
  // it is pushed (before the post-trade refetch) so destinations count old → new.
  const swap = useSwap();
  const { data: loopPort } = usePortfolio(address ?? undefined);
  const loopPortRef = useRef(loopPort);
  useEffect(() => {
    loopPortRef.current = loopPort;
  }, [loopPort]);
  const snapshot = useCallback(
    (): Snapshot => ({ cash: loopPortRef.current?.cashUsd, total: loopPortRef.current?.totalUsd }),
    [],
  );
  const placingAt = useRef(0);
  useEffect(() => {
    if (screen === "placing") placingAt.current = Date.now();
  }, [screen]);
  /** Run `fn` once Placing has been up for at least DWELL_MS. */
  const afterDwell = useCallback((fn: () => void) => {
    const t = setTimeout(fn, Math.max(0, DWELL_MS - (Date.now() - placingAt.current)));
    return () => clearTimeout(t);
  }, []);

  // Manual trade: Placing → Receipt (dwell first), or bounce back to Trade with
  // the form restored and the swap error shown.
  const placingTrade = screen === "placing" && params.kind === "trade";
  useEffect(() => {
    if (!placingTrade) return;
    if (swap.phase === "done" && swap.result) {
      const r = swap.result;
      const order = params.order as TradeOrder;
      const before = (params.before as Snapshot | undefined) ?? {};
      return afterDwell(() => {
        const loop: LoopParams = { flash: [order.symbol], txHash: r.txHash, prevCash: before.cash, prevTotal: before.total };
        setDir("push");
        // Trade and Placing both leave the stack: back from the receipt is the asset.
        setStack((s) => [
          ...s.filter((x) => x.screen !== "placing" && x.screen !== "trade"),
          { screen: "receipt", params: { order, txHash: r.txHash, at: Date.now(), loop } },
        ]);
        swap.reset();
      });
    }
    if (swap.phase === "error") {
      const draft = params.draft as TradeDraft | undefined;
      return afterDwell(() => {
        setDir("pop");
        setStack((s) =>
          s
            .filter((x) => x.screen !== "placing")
            .map((x, i, arr) => (i === arr.length - 1 && x.screen === "trade" ? { ...x, params: { ...x.params, draft } } : x)),
        );
      });
    }
  }, [placingTrade, swap, params, afterDwell]);

  // Leaving a trade receipt: land on the asset with the loop params + a toast.
  const closeTrade = useCallback(
    (order: TradeOrder, loop: LoopParams | undefined) => {
      notify(`${order.side === "sell" ? "Sold" : "Bought"} ${order.qty} ${order.ticker} · ${formatUsd(order.amountUsd)}`);
      setDir("pop");
      setStack((s) => {
        const base = s.filter((x) => x.screen !== "receipt" && x.screen !== "trade" && x.screen !== "placing");
        let i = base.length - 1;
        while (i >= 0 && base[i].screen !== "asset") i--;
        const trimmed = i >= 0 ? base.slice(0, i) : base;
        return [...trimmed, { screen: "asset", params: { symbol: order.symbol, loop } }];
      });
    },
    [notify],
  );
  // ── end feel-trade runtime (closeInvest follows `go` below) ─────────────────

  const goalRef = useRef(goal);
  const amountRef = useRef(amount);
  useEffect(() => {
    goalRef.current = goal;
    amountRef.current = amount;
  }, [goal, amount]);

  // go(target, params) pushes a route; go(-1) pops back; tab roots reset history.
  const go = useCallback(
    (target: string | number, p: Params = {}) => {
      // Back.
      if (typeof target === "number") {
        setDir("pop");
        setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
        return;
      }
      const next = target as Screen;

      if (next === "thinking") {
        setDir("push");
        const g = String(p.goal ?? "");
        const a = Number(p.amt ?? 0);
        setGoal(g);
        setAmount(a);
        setTone("balanced");
        setStack((s) => [...s, { screen: "thinking", params: {} }]);
        const startedAt = Date.now(); // feel-trade: Thinking dwells ≥ DWELL_MS
        void invest.allocate(g, a, "balanced").then((res) => {
          const swapIn = () =>
            setStack((s) => {
              // Replace the thinking route with plan (or fall back to goal).
              const base = s.filter((r) => r.screen !== "thinking");
              return [...base, { screen: res ? "plan" : "goal", params: {} }];
            });
          setTimeout(swapIn, Math.max(0, DWELL_MS - (Date.now() - startedAt)));
        });
        return;
      }

      // Basket → plan: review a fixed-weight basket on the real PlanScreen.
      if (next === "plan" && p.allocation && p.basket) {
        setDir("push");
        setBasketPlan({ allocation: p.allocation as AllocateResult, basket: p.basket as Basket });
        setAmount(Number(p.amt ?? 0));
        setGoal("");
        setTone("balanced");
        setStack((s) => [...s, { screen: "plan", params: {} }]);
        return;
      }

      // feel-trade: a manual trade's Placing carries the balances it started from.
      if (next === "placing") {
        setDir("push");
        setStack((s) => [...s, { screen: "placing", params: { ...p, before: snapshot() } }]);
        return;
      }

      // Tab roots / home reset the stack to a single route. Wallet is both a tab
      // root and a pushed screen, so the tab bar asks for the root with
      // `{ root: true }` — anywhere else it pushes and keeps its back arrow.
      const ROOTS: Screen[] = ["home", "portfolio", "market", "hub"];
      if (ROOTS.includes(next) || p.root === true) {
        setDir("fade");
        if (next === "home") {
          invest.reset();
          setBasketPlan(null);
        }
        setStack([{ screen: next, params: p }]);
        return;
      }

      setDir("push");
      setStack((s) => [...s, { screen: next, params: p }]);
    },
    [invest, snapshot],
  );

  // feel-trade: leaving Success → Home with the loop params + a toast.
  const closeInvest = useCallback(() => {
    const s = invest.success;
    const before = (params.before as Snapshot | undefined) ?? {};
    if (s) {
      notify(`Invested ${formatUsd(s.amountUsd)} across ${s.holdings.length} ${s.holdings.length === 1 ? "holding" : "holdings"}`);
      const loop: LoopParams = { flash: s.holdings.map((h) => h.symbol), txHash: s.txHash, prevCash: before.cash, prevTotal: before.total };
      go("home", { loop });
      return;
    }
    go("home");
  }, [invest.success, params.before, notify, go]);

  // Nudge Vera: re-run allocate with adjusted risk + goal hint; plan rebuilds.
  const onNudge = useCallback(
    (t: Tone) => {
      if (t === tone || rethinking) return;
      haptic.select();
      setTone(t);
      setRethinking(true);
      const adjustedGoal = goalRef.current + TONE_HINT[t];
      void invest.allocate(adjustedGoal, amountRef.current, TONE_RISK[t]).then(() => {
        setRethinking(false);
      });
    },
    [tone, rethinking, invest],
  );

  // Place the investment (server-signed plan + batched sponsored UserOp).
  const onInvest = useCallback(() => {
    if (!activeAllocation || !address) {
      notify("Loading your account, try again in a moment", "info");
      return;
    }
    haptic.medium();
    setDir("push");
    // feel-trade: kind + the balances before, for Success's consequence line.
    setStack((s) => [...s, { screen: "placing", params: { kind: "invest", before: snapshot() } }]);
    void invest.invest(activeAllocation, amount, address);
  }, [invest, activeAllocation, address, amount, notify, snapshot]);

  // Shared basket links open the basket on load:
  //   `/app?b=<id>`         a server-stored basket, fetched from /api/baskets/<id>
  //   `/app?basket=<param>` the self-contained encoded link (also `/demo?basket=`)
  // Neither is trusted — both go through sharedBasketFrom, which validates symbols,
  // renormalizes weights and recomputes risk — and a bad one just toasts. Demo never
  // hits the network, so `?b=` is ignored there. The params are stripped so a refresh
  // doesn't re-open the basket.
  useEffect(() => {
    if (demoPlay) return; // the landing's auto-playing phones ignore the page URL
    const initial = new URL(window.location.href).searchParams;
    if (!initial.has("basket") && !initial.has("b")) return;
    let cancelled = false;
    // Deferred a tick so the route push happens after first paint (and never
    // synchronously inside the effect).
    const t = setTimeout(async () => {
      const url = new URL(window.location.href);
      const shortId = url.searchParams.get("b");
      const param = url.searchParams.get("basket");
      url.searchParams.delete("b");
      url.searchParams.delete("basket");
      window.history.replaceState(window.history.state, "", url.toString());
      let res: DecodeResult;
      if (shortId && !demo) res = await fetchSharedBasket(shortId);
      else if (param) res = decodeBasketLink(param);
      else return;
      if (cancelled) return;
      if (res.ok) {
        setDir("push");
        setStack((s) => [...s, { screen: "basket", params: { basket: res.basket } }]);
      } else {
        notify(res.reason, "info");
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── gift-ui ─────────────────────────────────────────────────────────────────
  // A gift link opens the gift on load: `/app?gift=<id>` (the "Open in Stax"
  // button on the public /gift/<id> page). The id is opaque and never trusted —
  // GiftViewScreen only opens a sheet for a gift the signed-in person's own list
  // actually contains, so a guessed id shows nothing. The param is stripped so a
  // refresh doesn't re-open it.
  useEffect(() => {
    if (demoPlay) return; // the landing's auto-playing phones ignore the page URL
    if (!new URL(window.location.href).searchParams.has("gift")) return;
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      const id = url.searchParams.get("gift");
      url.searchParams.delete("gift");
      window.history.replaceState(window.history.state, "", url.toString());
      if (!id) return;
      setDir("push");
      setStack((s) => [...s, { screen: "gifts", params: { focus: id } }]);
    }, 0);
    return () => clearTimeout(t);
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ── end gift-ui ─────────────────────────────────────────────────────────────

  // Latest handlers for the demo autoplay driver (avoids stale closures).
  const goRef = useRef(go);
  const onInvestRef = useRef(onInvest);
  useEffect(() => {
    goRef.current = go;
    onInvestRef.current = onInvest;
  }, [go, onInvest]);

  // Demo autoplay for the landing phones. Loops a scripted walkthrough; fully
  // inert in the real app (demoPlay is null) and cancels cleanly on unmount.
  useEffect(() => {
    if (!demoPlay) return;
    // Respect reduced-motion: leave the preview static instead of auto-playing.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const run = async () => {
      await wait(1400); // settle on home first
      while (!cancelled) {
        if (demoPlay === "invest") {
          goRef.current("thinking", { goal: "Grow $300, mostly big names, keep some safe", amt: 300 });
          await wait(3400);
          if (cancelled) break;
          onInvestRef.current(); // plan -> placing -> success
          await wait(3800);
          if (cancelled) break;
          await wait(2600); // dwell on the success screen
          goRef.current("home");
          await wait(2600);
        } else {
          // The "vera" play now opens the hub — her menu — instead of the retired
          // Vera page, then builds a plan and returns.
          goRef.current("hub");
          await wait(4200);
          if (cancelled) break;
          goRef.current("thinking", { goal: "Put $250 into AI companies", amt: 250 });
          await wait(3600); // watch Vera build + sign the plan
          if (cancelled) break;
          goRef.current("hub");
          await wait(3800);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [demoPlay]);

  // Liquid Glass: the specular sheen on buttons tracks the pointer.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>(".btn");
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--gx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      btn.style.setProperty("--gy", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);


  // Drive screen from the real invest phase (Placing dwells ≥ DWELL_MS first).
  useEffect(() => {
    if (invest.phase === "done" && invest.success && screen === "placing" && params.kind === "invest") {
      const before = params.before;
      return afterDwell(() => {
        setDir("push");
        setStack((s) => {
          const base = s.filter((r) => r.screen !== "placing");
          return [...base, { screen: "success", params: { before } }];
        });
      });
    }
    if (invest.phase === "error" && screen === "placing") {
      // Invest error bounces back to the plan with the inline message.
      return afterDwell(() => {
        setDir("pop");
        setStack((s) => s.filter((r) => r.screen !== "placing"));
      });
    }
  }, [invest.phase, invest.success, screen, params.kind, params.before, afterDwell]);

  // Each screen names the browser tab (e.g. "Market · Stax") — in the real app
  // only; the demo phones embedded on the marketing page leave the page's title alone.
  useEffect(() => {
    if (demo) return;
    const NAMES: Record<Screen, string> = {
      home: "Your money",
      hub: "Invest",
      baskets: "Baskets",
      basket: "Basket",
      issuers: "Which is cheaper?",
      // gift-ui
      gift: "Give a basket",
      gifts: "Gifts",
      wallet: "Wallet",
      send: "Send",
      autopilot: "Autopilot",
      goal: "New plan",
      thinking: "Building your plan",
      plan: "Vera's plan",
      placing: "Securing your investment",
      success: "Invested",
      portfolio: "What you own",
      market: "Market",
      asset: "Asset",
      trade: "Trade",
      receipt: "Receipt",
      settings: "Settings",
      activity: "Activity",
      help: "Help",
    };
    document.title = `${NAMES[screen] ?? "Stax"} · Stax`;
  }, [screen, demo]);

  const onTab = (id: TabId) => {
    haptic.select();
    // The centre button opens the hub (every Vera feature, one row each), not the
    // goal flow. Wallet is a tab root here, so it arrives without a back arrow.
    if (id === "wallet") go("wallet", { root: true });
    else go(id === "invest" ? "hub" : id === "market" ? "market" : id === "portfolio" ? "portfolio" : "home");
  };

  // Left-edge swipe-to-go-back (iOS-style). Active only when there's a screen to
  // return to; vertical-dominant gestures fall through to normal scrolling. The
  // screen follows the finger live, then the pop transition completes the back.
  const canBack = stack.length > 1;
  const onTouchStart = (e: ReactTouchEvent) => {
    if (!canBack) return;
    const t = e.touches[0];
    if (t.clientX <= 28) dragRef.current = { x: t.clientX, y: t.clientY, active: false };
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const t = e.touches[0];
    const dx = t.clientX - d.x;
    const dy = t.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        dragRef.current = null; // vertical intent → let the screen scroll
        return;
      }
      d.active = true;
      setDragging(true);
    }
    setDragX(Math.max(0, Math.min(dx, 320)));
  };
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (d?.active && dragX > 78) {
      setDragX(0);
      go(-1);
    } else {
      setDragX(0); // snap back
    }
  };

  if (gated) {
    if (beta.loading && !beta.error) return <LoadingScreen />;
    if (beta.error || !beta.access || (beta.access.beta && beta.access.status !== "approved")) {
      return <BetaGateScreen access={beta.access} error={beta.error} onRetry={beta.refresh} />;
    }
  }

  // Tabs visible only on the root browse screens (Wallet only when it *is* a root).
  const walletIsRoot = screen === "wallet" && params.root === true;
  const showTabs =
    screen === "home" || screen === "portfolio" || screen === "market" || screen === "hub" || walletIsRoot;

  let view: React.ReactNode;
  switch (screen) {
    case "wallet":
      view = <WalletScreen go={go} root={params.root === true} />;
      break;
    case "hub":
      view = <HubScreen go={go} />;
      break;
    case "send":
      view = <SendScreen go={go} symbol={params.symbol as string | undefined} />;
      break;
    case "autopilot":
      view = <AutopilotScreen go={go} />;
      break;
    case "goal":
      view = <GoalScreen go={go} />;
      break;
    case "thinking":
      view = <ThinkingScreen />;
      break;
    case "baskets":
      view = <BasketsScreen go={go} />;
      break;
    case "basket":
      view = (
        <BasketDetailScreen
          go={go}
          id={params.id as string | undefined}
          shared={params.basket as Basket | undefined}
        />
      );
      break;
    case "issuers":
      view = <IssuerBoardScreen go={go} />;
      break;
    // ── gift-ui ───────────────────────────────────────────────────────────────
    case "gift":
      view = <GiftScreen go={go} basketId={params.basketId as string | undefined} />;
      break;
    case "gifts":
      view = <GiftViewScreen go={go} focus={params.focus as string | undefined} />;
      break;
    // ── end gift-ui ───────────────────────────────────────────────────────────
    case "plan":
      view = activeAllocation ? (
        <PlanScreen
          go={go}
          allocation={activeAllocation}
          amount={amount}
          tone={tone}
          rethinking={rethinking}
          busy={invest.busy}
          onNudge={onNudge}
          onInvest={onInvest}
          basket={basketPlan?.basket}
          goal={goal || undefined}
        />
      ) : (
        <GoalScreen go={go} />
      );
      break;
    case "placing":
      // feel-trade: manual trades follow the swap; Vera invests follow useInvest.
      view =
        params.kind === "trade" ? (
          <PlacingScreen phase={swap.phase} kind="trade" side={(params.order as TradeOrder).side} />
        ) : (
          <PlacingScreen phase={invest.phase} kind="invest" />
        );
      break;
    case "success":
      view = invest.success ? (
        <SuccessScreen success={invest.success} prevCash={(params.before as Snapshot | undefined)?.cash} onDone={closeInvest} />
      ) : (
        <HomeScreen go={go} />
      );
      break;
    case "portfolio":
      view = <PortfolioScreen go={go} />;
      break;
    case "market":
      view = <MarketScreen go={go} />;
      break;
    case "asset":
      view = (
        <AssetDetailScreen
          go={go}
          symbol={String(params.symbol ?? "")}
          loop={params.loop as LoopParams | undefined}
          venue={params.venue === "bstock" || params.venue === "ondo" ? params.venue : undefined}
        />
      );
      break;
    case "trade":
      view = (
        <TradeScreen
          go={go}
          symbol={String(params.symbol ?? "")}
          initialSide={params.side === "sell" ? "sell" : "buy"}
          swap={swap}
          draft={params.draft as TradeDraft | undefined}
          venue={params.venue === "bstock" || params.venue === "ondo" ? params.venue : undefined}
        />
      );
      break;
    case "receipt": {
      // feel-trade: a just-filled manual trade carries `order`; history receipts don't.
      const rp = params as {
        title?: string;
        amount?: number;
        txHash?: string;
        ref?: string;
        date?: string;
        order?: TradeOrder;
        at?: number;
        loop?: LoopParams;
        legs?: ActivityLeg[];
        failed?: boolean;
      };
      const { order, loop, ref: refCode, ...rest } = rp;
      view = (
        <ReceiptScreen
          go={go}
          title={rest.title}
          amount={rest.amount}
          txHash={rest.txHash}
          ref={refCode}
          date={rest.date}
          order={order}
          at={rest.at}
          legs={rest.legs}
          failed={rest.failed}
          onClose={order ? () => closeTrade(order, loop) : undefined}
        />
      );
      break;
    }
    case "settings":
      view = <SettingsScreen go={go} />;
      break;
    case "activity":
      view = <ActivityScreen go={go} />;
      break;
    case "help":
      view = <HelpScreen go={go} />;
      break;
    case "home":
    default:
      view = <HomeScreen go={go} loop={params.loop as LoopParams | undefined} />;
  }

  return (
    <>
      <div key={screen} className={`nav-${dir}`} style={{ position: "absolute", inset: 0 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: dragX ? `translateX(${dragX}px)` : undefined,
            transition: dragging ? "none" : "transform 0.3s var(--ease-out)",
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={endDrag}
          onTouchCancel={endDrag}
        >
          {/* Inline error from the invest flow — surfaced on the plan/goal screens. */}
        {invest.error && (screen === "plan" || screen === "goal") && (
          <div
            role="button"
            aria-label="Dismiss error"
            className="anim-rise tap"
            style={{
              position: "absolute",
              top: 58,
              left: 16,
              right: 16,
              zIndex: 60,
              display: "flex",
              gap: 9,
              alignItems: "center",
              background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
              color: "var(--neg)",
              padding: "12px 14px",
              borderRadius: "var(--rr)",
              fontSize: 14,
              fontWeight: 500,
              boxShadow: "var(--shadow)",
              cursor: "pointer",
            }}
            onClick={invest.clearError}
          >
            {invest.error}
          </div>
        )}
          {view}
        </div>
      </div>
      {showTabs && <TabBar active={tabFor(screen)} onNav={onTab} pro />}
      <InstallPrompt />
    </>
  );
}
