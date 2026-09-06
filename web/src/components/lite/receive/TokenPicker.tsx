"use client";

// Step 2 of "From any network": which token on the chosen network. Symbol +
// name rows; the network is shown at the top so the pair is never in doubt.
import { Icon } from "@/components/design";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { NetworkMark } from "@/lib/chainMarks";
import { haptic } from "@/lib/haptics";
import type { ReceiveNetwork, ReceiveToken } from "@/hooks/useReceive";
import s from "./receive.module.css";

export function TokenPicker({
  network,
  onPick,
}: {
  network: ReceiveNetwork;
  onPick: (t: ReceiveToken) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "2px 0 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 2px" }}>
        <span className={s.markDisc} style={{ width: 28, height: 28 }}>
          <NetworkMark networkKey={network.key} chainId={network.id} name={network.name} size={18} />
        </span>
        <span style={{ fontSize: 14.5, color: "var(--ink-2)" }}>
          What are you sending on <b style={{ color: "var(--ink)" }}>{network.name}</b>?
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="list">
        {network.tokens.map((t) => (
          <button
            key={t.address}
            type="button"
            role="listitem"
            className={s.option}
            style={{ minHeight: 60 }}
            onClick={() => { haptic.select(); onPick(t); }}
          >
            <TokenLogo symbol={t.symbol} name={t.name} size={36} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>{t.symbol}</span>
              <span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{t.name}</span>
            </span>
            <Icon name="chevR" size={18} style={{ color: "var(--ink-3)", flex: "none" }} />
          </button>
        ))}
      </div>
    </div>
  );
}
