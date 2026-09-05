"use client";

// Network primitives — the one place the app talks about which chain it's on.
//   ChainMark      the network's brand mark (Base blue circle / Mantle) as an image
//   NetworkChip    a quiet pill (mark + name) for headers; taps open Settings
//   NetworkSwitch  the two-option segmented control (Base · Mantle) in Settings
//   ChainLaunching the calm "being switched on" state for a chain whose Stax
//                  contracts aren't deployed yet (no spinner, no jargon)
//
// The blockchain is the engine, never the dashboard: these render the network as a
// plain product setting ("Base is the default. Mantle holds your earlier
// investments."), never as a wallet-style chain picker.
import type { CSSProperties, ReactNode } from "react";
import { CHAIN_KEYS, CHAINS, type ChainKey, type StaxChain } from "@/lib/chains";
import { useChainKey } from "@/lib/chains/active";
import { haptic } from "@/lib/haptics";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

export function ChainMark({ chain, size = 20 }: { chain: StaxChain; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset in /public
    <img
      src={chain.brand.logo}
      alt=""
      width={size}
      height={size}
      decoding="async"
      style={{ width: size, height: size, borderRadius: "50%", display: "block", flex: "none" }}
    />
  );
}

// Header chip — same 44px height as the icon buttons beside it so the top bar
// reads as one row of controls. Glass like a chip, ink like a label.
export function NetworkChip({ chain, onClick }: { chain: StaxChain; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="chip tap"
      aria-label={`Network: ${chain.name}. Change in Settings`}
      style={{ height: 44, padding: "0 13px 0 9px", gap: 7, color: "var(--ink)", fontWeight: 600 }}
    >
      <ChainMark chain={chain} size={20} />
      {chain.name}
    </button>
  );
}

// Settings control. Reuses the app's sliding-thumb segmented control so it
// feels like the buy/sell toggle, with each network's mark beside its name.
export function NetworkSwitch({ onSwitched }: { onSwitched?: (chain: StaxChain) => void }) {
  const [key, setKey] = useChainKey();
  const { notify } = useToast();
  const idx = Math.max(0, CHAIN_KEYS.indexOf(key));

  const choose = (k: ChainKey) => {
    if (k === key) return;
    haptic.select();
    setKey(k);
    const next = CHAINS[k];
    // Hooks are keyed by chain, so balances/holdings refetch on their own; the
    // toast is the only confirmation the user needs.
    notify(`Switched to ${next.name}`, "check");
    onSwitched?.(next);
  };

  return (
    <div className="seg" role="radiogroup" aria-label="Network">
      <span
        className="seg-thumb"
        style={{
          width: `calc((100% - 8px) / ${CHAIN_KEYS.length})`,
          left: 4,
          transform: `translateX(calc(${idx} * 100%))`,
        }}
      />
      {CHAIN_KEYS.map((k) => {
        const c = CHAINS[k];
        const on = k === key;
        return (
          <button
            key={k}
            role="radio"
            aria-checked={on}
            onClick={() => choose(k)}
            className={`seg-item ${on ? "is-on" : ""}`}
            style={{ height: 44, gap: 8 }}
          >
            <ChainMark chain={c} size={20} />
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

// The honest "not on yet" state. Calm by design: a mark, a sentence, and a
// next step the user can actually take (browse prices). No spinner — nothing is
// loading, it's simply not switched on yet.
export function ChainLaunching({
  chain,
  action,
  style,
}: {
  chain: StaxChain;
  /** Optional next step (e.g. "Browse the market"). */
  action?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="card" role="status" style={{ padding: 18, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            flex: "none",
            display: "grid",
            placeItems: "center",
            background: "var(--surface-2)",
          }}
        >
          <ChainMark chain={chain} size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: "-.01em" }}>
            Stax on {chain.name} is being switched on
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>
            You can still browse prices. Investing opens shortly.
          </div>
        </div>
      </div>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/** Small inline version for tight spots (Plan's pinned bar, Autopilot). */
export function ChainLaunchingLine({ chain }: { chain: StaxChain }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontSize: 13,
        fontWeight: 600,
        color: "var(--ink-2)",
        textAlign: "center",
        lineHeight: 1.4,
      }}
    >
      <Icon name="clock" size={15} style={{ flex: "none", color: "var(--ink-3)" }} />
      Stax on {chain.name} is being switched on. Investing opens shortly.
    </div>
  );
}
