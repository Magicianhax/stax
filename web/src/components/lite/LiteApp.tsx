"use client";

// Stax app shell — a small screen router that mirrors the design's go(screen,
// params) orchestrator (app.jsx) while wiring the REAL hooks end to end.
//
// Invest loop (Vera):
//   home → goal → thinking → plan → placing → success
//   • goal "Build my plan"  -> useInvest.allocate (POST /api/allocate)
//   • plan nudge chips        -> re-run allocate() with an adjusted riskTolerance
//   • plan "Invest $X · free" -> useInvest.invest (POST /api/invest-plan +
//                                sendSponsoredCalls); <Placing> follows real phase
//   • success                 -> confetti + holdings + Mantlescan receipt
//
// Browse / own / trade (Pro depth, always available here):
//   portfolio · market → asset → trade → receipt · activity · vera
//
// Navigation keeps a small history stack so go(-1) returns to the prior screen.
// The bottom TabBar lives here (the design owns its own chrome).
import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { useInvest } from "@/hooks/useInvest";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { haptic } from "@/lib/haptics";
import { TabBar, type TabId, useToast } from "@/components/design";
import { InstallPrompt } from "@/components/app/InstallPrompt";
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
import { VeraScreen } from "./screens/VeraScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ActivityScreen } from "./screens/ActivityScreen";
import { HelpScreen } from "./screens/HelpScreen";
import { WalletScreen } from "./screens/WalletScreen";
import { SendScreen } from "./screens/SendScreen";
import { AutopilotScreen } from "./screens/AutopilotScreen";

type Screen =
  | "home"
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
  | "vera"
  | "settings"
  | "activity"
  | "help";

type Tone = "balanced" | "safer" | "bolder" | "simple";
type Params = Record<string, unknown>;

interface Route {
  screen: Screen;
  params: Params;
}

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
  if (screen === "vera") return "vera";
  return "home";
}

export function LiteApp({ demoPlay = null }: { demoPlay?: "invest" | "vera" | null }) {
  const invest = useInvest();
  const { address } = useSmartAccount();
  const { notify } = useToast();

  const [stack, setStack] = useState<Route[]>([{ screen: "home", params: {} }]);
  const current = stack[stack.length - 1];
  const { screen, params } = current;

  const [goal, setGoal] = useState("");
  const [amount, setAmount] = useState(0);
  const [tone, setTone] = useState<Tone>("balanced");
  const [rethinking, setRethinking] = useState(false);

  // Navigation direction drives the screen transition (push / pop / fade).
  const [dir, setDir] = useState<"push" | "pop" | "fade">("fade");
  // Live edge-swipe-back drag offset.
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; active: boolean } | null>(null);

  const goalRef = useRef(goal);
  const amountRef = useRef(amount);
  goalRef.current = goal;
  amountRef.current = amount;

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
        void invest.allocate(g, a, "balanced").then((res) => {
          setStack((s) => {
            // Replace the thinking route with plan (or fall back to goal).
            const base = s.filter((r) => r.screen !== "thinking");
            return [...base, { screen: res ? "plan" : "goal", params: {} }];
          });
        });
        return;
      }

      // Tab roots / home reset the stack to a single route.
      const ROOTS: Screen[] = ["home", "portfolio", "market", "vera"];
      if (ROOTS.includes(next)) {
        setDir("fade");
        if (next === "home") invest.reset();
        setStack([{ screen: next, params: p }]);
        return;
      }

      setDir("push");
      setStack((s) => [...s, { screen: next, params: p }]);
    },
    [invest],
  );

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
    if (!invest.allocation || !address) {
      notify("Loading your account, try again in a moment", "info");
      return;
    }
    haptic.medium();
    setDir("push");
    setStack((s) => [...s, { screen: "placing", params: {} }]);
    void invest.invest(invest.allocation, amount, address);
  }, [invest, address, amount, notify]);

  // Latest handlers for the demo autoplay driver (avoids stale closures).
  const goRef = useRef(go);
  goRef.current = go;
  const onInvestRef = useRef(onInvest);
  onInvestRef.current = onInvest;

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
          goRef.current("vera");
          await wait(4200);
          if (cancelled) break;
          goRef.current("thinking", { goal: "Put $250 into AI companies", amt: 250 });
          await wait(3600); // watch Vera build + sign the plan
          if (cancelled) break;
          goRef.current("vera");
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

  // Drive screen from the real invest phase.
  useEffect(() => {
    if (invest.phase === "done" && invest.success) {
      setDir("push");
      setStack((s) => {
        const base = s.filter((r) => r.screen !== "placing");
        return [...base, { screen: "success", params: {} }];
      });
    }
    if (invest.phase === "error" && screen === "placing") {
      // Invest error bounces back to the plan with the inline message.
      setDir("pop");
      setStack((s) => s.filter((r) => r.screen !== "placing"));
    }
  }, [invest.phase, invest.success, screen]);

  // Each screen names the browser tab (e.g. "Market · Stax").
  useEffect(() => {
    const NAMES: Record<Screen, string> = {
      home: "Your money",
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
      vera: "Vera",
      settings: "Settings",
      activity: "Activity",
      help: "Help",
    };
    document.title = `${NAMES[screen] ?? "Stax"} · Stax`;
  }, [screen]);

  const onTab = (id: TabId) => {
    haptic.select();
    if (id === "invest") go("goal");
    else go(id === "market" ? "market" : id === "portfolio" ? "portfolio" : id === "vera" ? "vera" : "home");
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

  // Tabs visible only on the root browse screens.
  const showTabs =
    screen === "home" || screen === "portfolio" || screen === "market" || screen === "vera";

  let view: React.ReactNode;
  switch (screen) {
    case "wallet":
      view = <WalletScreen go={go} />;
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
    case "plan":
      view = invest.allocation ? (
        <PlanScreen
          go={go}
          allocation={invest.allocation}
          amount={amount}
          tone={tone}
          rethinking={rethinking}
          busy={invest.busy}
          onNudge={onNudge}
          onInvest={onInvest}
        />
      ) : (
        <GoalScreen go={go} />
      );
      break;
    case "placing":
      view = <PlacingScreen phase={invest.phase} />;
      break;
    case "success":
      view = invest.success ? (
        <SuccessScreen success={invest.success} onDone={() => go("home")} />
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
      view = <AssetDetailScreen go={go} symbol={String(params.symbol ?? "")} />;
      break;
    case "trade":
      view = (
        <TradeScreen
          go={go}
          symbol={String(params.symbol ?? "")}
          initialSide={params.side === "sell" ? "sell" : "buy"}
        />
      );
      break;
    case "receipt":
      view = (
        <ReceiptScreen
          go={go}
          title={params.title as string | undefined}
          amount={params.amount as number | undefined}
          txHash={params.txHash as string | undefined}
          ref={params.ref as string | undefined}
          date={params.date as string | undefined}
        />
      );
      break;
    case "vera":
      view = <VeraScreen go={go} />;
      break;
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
      view = <HomeScreen go={go} />;
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
