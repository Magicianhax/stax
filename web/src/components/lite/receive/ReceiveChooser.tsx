"use client";

// The Receive chooser (Base): three ways money comes in, one row each. Add
// cash is visible but disabled with a "Coming soon" tag until Coinbase Onramp
// is configured, so the row never becomes a dead tap that looks live.
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/design";
import { haptic } from "@/lib/haptics";
import s from "./receive.module.css";

export type ReceiveOption = "wallet" | "cash" | "network";

function Row({
  icon,
  title,
  hint,
  onClick,
  disabled,
  tag,
}: {
  icon: IconName;
  title: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
  tag?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={s.option}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={() => { haptic.light(); onClick?.(); }}
    >
      <span
        aria-hidden
        style={{ width: 44, height: 44, borderRadius: 99, flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}
      >
        <Icon name={icon} size={21} stroke={2.1} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</span>
          {tag}
        </span>
        <span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.4 }}>{hint}</span>
      </span>
      {!disabled && <Icon name="chevR" size={18} style={{ color: "var(--ink-3)", flex: "none" }} />}
    </button>
  );
}

export function ReceiveChooser({
  addCashEnabled,
  onPick,
}: {
  addCashEnabled: boolean;
  onPick: (option: ReceiveOption) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 0 6px" }}>
      <Row
        icon="wallet"
        title="From another wallet"
        hint="Connect a wallet you already have and move dollars over."
        onClick={() => onPick("wallet")}
      />
      <Row
        icon="card"
        title="Add cash"
        hint={addCashEnabled ? "Card or bank, through Coinbase." : "Card or bank payments are on the way."}
        disabled={!addCashEnabled}
        onClick={() => onPick("cash")}
        tag={
          !addCashEnabled ? (
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 8px", borderRadius: 99, background: "var(--surface-2)", color: "var(--ink-2)", whiteSpace: "nowrap" }}>
              Coming soon
            </span>
          ) : undefined
        }
      />
      <Row
        icon="globe"
        title="From any network"
        hint="Get an address for the network and token you have."
        onClick={() => onPick("network")}
      />
      <p style={{ margin: "8px 4px 0", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        Your Stax account lives on Base. Only USDC counts as cash here.
      </p>
    </div>
  );
}
