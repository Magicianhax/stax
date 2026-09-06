"use client";

// Step 1 of "From any network": network and token, two dropdowns on one screen,
// then Continue. The token list follows the network (a new network clears the
// token), so the pair is always chosen deliberately before any address shows.
import { NetworkMark } from "@/lib/chainMarks";
import { tokenLogoFor } from "@/lib/tokenLogos";
import { TokenLogo } from "@/components/lite/TokenLogo";
import type { ReceiveNetwork, ReceiveToken } from "@/hooks/useReceive";
import { Dropdown } from "./Dropdown";

export function PickStep({
  networks,
  loading,
  error,
  onRetry,
  network,
  token,
  onNetwork,
  onToken,
  onContinue,
}: {
  networks: ReceiveNetwork[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  network: ReceiveNetwork | null;
  token: ReceiveToken | null;
  onNetwork: (n: ReceiveNetwork) => void;
  onToken: (t: ReceiveToken) => void;
  onContinue: () => void;
}) {
  if (error && !networks) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "6px 2px 8px" }}>
        <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{error}</p>
        <button type="button" className="btn btn-ghost tap" onClick={onRetry} style={{ height: 48, fontSize: 15 }}>
          Try again
        </button>
      </div>
    );
  }

  const networkOptions = (networks ?? []).map((n) => ({
    key: n.key,
    label: n.name,
    logo: <NetworkMark networkKey={n.key} chainId={n.id} name={n.name} size={36} />,
  }));
  const tokenOptions = (network?.tokens ?? []).map((t) => ({
    key: t.address,
    label: t.symbol,
    secondary: t.name,
    logo: <TokenLogo symbol={t.symbol} name={t.name} size={36} logo={tokenLogoFor(t.symbol)} />,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "2px 0 6px" }}>
      <p style={{ margin: "0 2px", fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        Where is the money right now?
      </p>
      <Dropdown
        label="Network"
        placeholder="Choose a network"
        options={networkOptions}
        value={network?.key ?? null}
        loading={loading || !networks}
        onChange={(key) => {
          const n = networks?.find((x) => x.key === key);
          if (n) onNetwork(n);
        }}
      />
      <Dropdown
        label="Token"
        placeholder="Choose a token"
        hint={network ? undefined : "Pick a network first"}
        options={tokenOptions}
        value={token?.address ?? null}
        disabled={!network}
        onChange={(key) => {
          const t = network?.tokens.find((x) => x.address === key);
          if (t) onToken(t);
        }}
      />
      <button
        type="button"
        className="btn btn-primary btn-block tap"
        disabled={!network || !token}
        style={{ height: 52, marginTop: 4 }}
        onClick={onContinue}
      >
        Continue
      </button>
    </div>
  );
}
