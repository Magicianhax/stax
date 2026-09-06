"use client";

// Step 2b (non-EVM networks only): where to send the money back if something
// goes wrong. The person's own address on that same network. Shape-checked
// here; the server validates for real.
import { useState } from "react";
import { isValidRefundAddress, type ReceiveNetwork, type ReceiveToken } from "@/hooks/useReceive";
import { haptic } from "@/lib/haptics";

export function RefundAddressStep({
  network,
  token,
  initial = "",
  onContinue,
}: {
  network: ReceiveNetwork;
  token: ReceiveToken;
  /** Previously entered address (coming back from the card). */
  initial?: string;
  onContinue: (refundTo: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const trimmed = value.trim();
  const ok = isValidRefundAddress(network.vm, trimmed);
  const showError = touched && trimmed.length > 0 && !ok;

  const submit = () => {
    setTouched(true);
    if (!ok) return;
    haptic.light();
    onContinue(trimmed);
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      style={{ display: "flex", flexDirection: "column", gap: 14, padding: "2px 0 6px" }}
    >
      <div style={{ padding: "0 2px" }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>Your {network.name} address</div>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
          In case something goes wrong, we send it back here. Use the {network.name} wallet you are sending {token.symbol} from.
        </p>
      </div>
      <label className="field" style={{ display: "flex", alignItems: "center", padding: "0 16px", minHeight: 54 }}>
        <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Refund address on {network.name}
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={`Paste your ${network.name} address`}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          aria-invalid={showError || undefined}
          aria-describedby={showError ? "refund-error" : undefined}
          className="mono"
          style={{ flex: 1, fontSize: 14, minWidth: 0, padding: "14px 0" }}
        />
      </label>
      {showError && (
        <p id="refund-error" role="alert" style={{ margin: "-6px 2px 0", fontSize: 13, color: "var(--neg)", lineHeight: 1.45 }}>
          That doesn&apos;t look like a {network.name} address. Check it and try again.
        </p>
      )}
      <button
        type="submit"
        className="btn btn-primary btn-block tap"
        disabled={trimmed.length === 0 || !ok}
        style={{ height: 52 }}
      >
        Show my address
      </button>
    </form>
  );
}
