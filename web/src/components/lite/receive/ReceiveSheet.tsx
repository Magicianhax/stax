"use client";

// The Base Receive sheet: chooser → one of three sub-flows, all inside a single
// BottomSheet so the sheet never closes and reopens between steps. Add cash
// hands off to Wallet's existing Add-money sheet when Coinbase Onramp is
// configured; otherwise the chooser shows it as "Coming soon".
import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/design";
import { SheetStep } from "@/components/motion";
import { ReceiveChooser, type ReceiveOption } from "./ReceiveChooser";
import { FromWallet } from "./FromWallet";
import { AnyNetwork } from "./AnyNetwork";
import { SheetHeader } from "./SheetHeader";

type View = "chooser" | "wallet" | "network";

export function ReceiveSheet({
  open,
  onClose,
  recipient,
  addCashEnabled,
  onAddCash,
}: {
  open: boolean;
  onClose: () => void;
  /** The user's Stax account on Base (smart account); null while it loads. */
  recipient: `0x${string}` | null;
  addCashEnabled: boolean;
  onAddCash: () => void;
}) {
  const [view, setView] = useState<View>("chooser");
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const show = (v: View) => {
    setDir(v === "chooser" ? "back" : "fwd");
    setView(v);
  };

  // Always reopen on the chooser — a sub-flow left half-done shouldn't greet
  // the person next time. Reset after the close animation so it doesn't flash.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setView("chooser");
      setDir("fwd");
    }, 240);
    return () => clearTimeout(t);
  }, [open]);

  const pick = (o: ReceiveOption) => {
    if (o === "cash") {
      onAddCash();
      return;
    }
    show(o);
  };

  return (
    <BottomSheet open={open} onClose={onClose} label="Receive">
      <SheetStep step={view} dir={dir}>
        {view === "chooser" && (
          <>
            <SheetHeader title="Receive" onClose={onClose} />
            <ReceiveChooser addCashEnabled={addCashEnabled} onPick={pick} />
          </>
        )}
        {view === "wallet" && <FromWallet recipient={recipient} onBack={() => show("chooser")} onClose={onClose} />}
        {view === "network" && <AnyNetwork open={open} onBackToChooser={() => show("chooser")} onClose={onClose} />}
      </SheetStep>
    </BottomSheet>
  );
}
