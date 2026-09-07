"use client";

// The address card — the only place a deposit address is ever shown, and only
// after both the network and the token are chosen. QR on a white tile (QR
// readers need the contrast in dark mode too), one mono address row that IS the
// copy button (no second "Copy address" button under it), the
// one loud line on the accent surface (icon in accent, words in ink so the
// pairing clears AA in both modes), and the live deposit list beneath.
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Icon, useToast } from "@/components/design";
import { haptic } from "@/lib/haptics";
import { usdWhole } from "@/lib/format";
import type { DepositAddressResponse, DepositRow } from "@/hooks/useReceive";
import { DepositHistory } from "./DepositHistory";
import s from "./receive.module.css";

function shortMid(addr: string): string {
  if (addr.length <= 22) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

export function AddressCard({
  data,
  networkName,
  deposits,
  depositsLoading,
}: {
  data: DepositAddressResponse;
  networkName: string;
  deposits: DepositRow[] | undefined;
  depositsLoading: boolean;
}) {
  const { notify } = useToast();
  const [more, setMore] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.address);
      haptic.light();
      notify("Address copied", "check");
    } catch {
      /* clipboard may be unavailable; the QR + visible address still work */
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ padding: 14, background: "#fff", borderRadius: 22, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.06)", lineHeight: 0 }}>
        <QRCodeSVG value={data.address} size={168} level="M" marginSize={0} bgColor="#ffffff" fgColor="#1c201a" />
      </div>

      {/* One copy affordance: the address row itself. Tapping anywhere on it copies. */}
      <button
        type="button"
        onClick={copy}
        className={`${s.option} tap`}
        aria-label={`Copy address ${data.address}`}
        style={{ minHeight: 52, padding: "8px 8px 8px 16px", gap: 12 }}
      >
        <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 13.5, letterSpacing: "-.01em", overflowWrap: "anywhere" }}>{shortMid(data.address)}</span>
        <span
          aria-hidden
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 99, flex: "none", background: "var(--primary)", color: "var(--primary-ink)", fontSize: 13, fontWeight: 700 }}
        >
          <Icon name="copy" size={15} stroke={2.2} />
          Copy
        </span>
      </button>

      <div
        role="note"
        style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 9, padding: "12px 13px", borderRadius: 14, background: "var(--accent-soft)", color: "var(--ink)", fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}
      >
        <Icon name="info" size={17} stroke={2.2} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
        <span>
          Send only <b style={{ fontWeight: 800 }}>{data.symbol} on {networkName}</b> to this address.
        </span>
      </div>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, padding: "0 4px", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        <span>
          {data.ownAddress
            ? "This is your own account address. USDC sent here is your cash right away, usually within a minute."
            : "Arrives as USD cash in your Stax account, usually within a few minutes."}
        </span>
        {!data.ownAddress && data.minUsd > 0 && (
          <span>
            Send at least about <b className="tnum" style={{ color: "var(--ink)" }}>{usdWhole(data.minUsd)}</b>
            {data.feeUsd > 0 ? ` · network cost about ${data.feeUsd < 1 ? `${Math.ceil(data.feeUsd * 100)}¢` : usdWhole(data.feeUsd)}` : ""}
          </span>
        )}
      </div>

      <div style={{ width: "100%", padding: "0 4px" }}>
        <button
          type="button"
          className={s.disclosure}
          aria-expanded={more}
          aria-controls="receive-what-if"
          onClick={() => setMore((v) => !v)}
        >
          What if I send something else?
          <Icon name="chevD" size={16} />
        </button>
        {more && (
          <p id="receive-what-if" style={{ margin: "0 0 4px", padding: "0 4px", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
            It may be lost. Double-check the network and the token before you send.
          </p>
        )}
      </div>

      {/* Bridged addresses get a live deposit list; the account's own address
          shows nothing here (its history lives in Wallet transactions). */}
      {!data.ownAddress && (
        <div style={{ width: "100%", borderTop: "1px solid var(--line-2)" }}>
          <DepositHistory deposits={deposits} loading={depositsLoading} />
        </div>
      )}
    </div>
  );
}
