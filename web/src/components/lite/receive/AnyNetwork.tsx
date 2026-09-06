"use client";

// "From any network" wizard: pick (network + token dropdowns) → (refund
// address on non-EVM networks) → address card. The address is requested only
// once both picks are made, so there is never an address on screen without its
// network + token.
import { useEffect, useRef, useState } from "react";
import {
  useDepositAddress,
  useDepositStatus,
  useReceiveNetworks,
  type ReceiveNetwork,
  type ReceiveToken,
} from "@/hooks/useReceive";
import { Spinner } from "../screens/primitives";
import { PickStep } from "./PickStep";
import { RefundAddressStep } from "./RefundAddressStep";
import { AddressCard } from "./AddressCard";
import { SheetHeader } from "./SheetHeader";
import s from "./receive.module.css";

type Step = "pick" | "refund" | "address";

export function AnyNetwork({
  open,
  onBackToChooser,
  onClose,
}: {
  /** Whether the sheet is on screen — gates the 6 s status poll. */
  open: boolean;
  onBackToChooser: () => void;
  onClose: () => void;
}) {
  const networks = useReceiveNetworks();
  const deposit = useDepositAddress();
  const [step, setStep] = useState<Step>("pick");
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [network, setNetwork] = useState<ReceiveNetwork | null>(null);
  const [token, setToken] = useState<ReceiveToken | null>(null);
  const [refundTo, setRefundTo] = useState<string | undefined>(undefined);

  const go = (next: Step, direction: "fwd" | "back" = "fwd") => {
    setDir(direction);
    setStep(next);
  };

  // Request the address once we land on the final step with both picks in hand.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (step !== "address" || !network || !token) return;
    const key = `${network.id}:${token.address}:${refundTo ?? ""}`;
    if (requested.current === key) return;
    requested.current = key;
    deposit.mutate({
      originChainId: network.id,
      originCurrency: token.address,
      refundTo,
      symbol: token.symbol,
      vm: network.vm,
    });
    // `deposit` is a stable mutation object from react-query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, network, token, refundTo]);

  const address = step === "address" ? deposit.data?.address : undefined;
  const status = useDepositStatus(address, open && step === "address");

  const pickNetwork = (n: ReceiveNetwork) => {
    if (n.key === network?.key) return;
    setNetwork(n);
    setToken(null);
    setRefundTo(undefined);
  };
  const pickToken = (t: ReceiveToken) => setToken(t);
  const continueFromPick = () => {
    if (!network || !token) return;
    if (network.vm === "evm") {
      setRefundTo(undefined);
      go("address");
    } else {
      go("refund");
    }
  };
  const continueWithRefund = (addr: string) => {
    setRefundTo(addr);
    go("address");
  };

  const back = () => {
    if (step === "pick") return onBackToChooser();
    if (step === "refund") return go("pick", "back");
    // From the address card go back to the picks (kept); a new pick asks for a new address.
    requested.current = null;
    deposit.reset();
    return go(network?.vm === "evm" ? "pick" : "refund", "back");
  };

  const title =
    step === "pick" ? "From any network"
    : step === "refund" ? "Refund address"
    : token && network ? `${token.symbol} on ${network.name}` : "Your address";

  return (
    <>
      <SheetHeader title={title} onBack={back} onClose={onClose} />
      <div key={step} className={`${s.step} ${dir === "back" ? s.stepBack : ""}`}>
        {step === "pick" && (
          <PickStep
            networks={networks.data}
            loading={networks.isPending}
            error={networks.error ? networks.error.message : null}
            onRetry={() => networks.refetch()}
            network={network}
            token={token}
            onNetwork={pickNetwork}
            onToken={pickToken}
            onContinue={continueFromPick}
          />
        )}
        {step === "refund" && network && token && (
          <RefundAddressStep network={network} token={token} initial={refundTo} onContinue={continueWithRefund} />
        )}
        {step === "address" && network && token && (
          deposit.data ? (
            <AddressCard
              data={deposit.data}
              networkName={network.name}
              deposits={status.data}
              depositsLoading={status.isPending}
            />
          ) : deposit.isError ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "6px 2px 8px" }}>
              <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{deposit.error.message}</p>
              <button
                type="button"
                className="btn btn-ghost tap"
                style={{ height: 48, fontSize: 15 }}
                onClick={() => { requested.current = null; deposit.reset(); go("address"); }}
              >
                Try again
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "36px 0 40px", color: "var(--ink-2)" }}>
              <Spinner />
              <span style={{ fontSize: 14 }}>Getting your {token.symbol} address on {network.name}…</span>
            </div>
          )
        )}
      </div>
    </>
  );
}
