// Network marks for the Receive flow — the real logo of every network we accept
// money from, self-hosted as 256px PNGs under /public/icons/networks (Trust
// Wallet assets), rendered as a round image. Keyed by the network `key` from
// /api/receive/networks with Relay's other slugs aliased; falls back to the
// chain id, then to a lettered disc so an unknown network never renders blank.
import type { CSSProperties } from "react";

export type ChainMarkKey =
  | "base"
  | "ethereum"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "bnb"
  | "avalanche"
  | "mantle"
  | "solana"
  | "tron"
  | "bitcoin";

const BY_ID: Record<number, ChainMarkKey> = {
  8453: "base",
  1: "ethereum",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon",
  56: "bnb",
  43114: "avalanche",
  5000: "mantle",
  792703809: "solana",
  728126428: "tron",
  8253038: "bitcoin",
};

const IMAGE: Record<ChainMarkKey, string> = {
  base: "/brand/partners/base.svg",
  ethereum: "/icons/networks/ethereum.png",
  arbitrum: "/icons/networks/arbitrum.png",
  optimism: "/icons/networks/optimism.png",
  polygon: "/icons/networks/polygon.png",
  bnb: "/icons/networks/bnb.png",
  avalanche: "/icons/networks/avalanche.png",
  mantle: "/icons/networks/mantle.png",
  solana: "/icons/networks/solana.png",
  tron: "/icons/networks/tron.png",
  bitcoin: "/icons/networks/bitcoin.png",
};

// Relay slugs that differ from our mark names.
const ALIAS: Record<string, ChainMarkKey> = {
  bsc: "bnb",
  "bnb-chain": "bnb",
  binance: "bnb",
  eth: "ethereum",
  btc: "bitcoin",
  arb: "arbitrum",
  op: "optimism",
  matic: "polygon",
  avax: "avalanche",
  sol: "solana",
};

function markKey(key: string | undefined, id: number | undefined): ChainMarkKey | undefined {
  const raw = key?.toLowerCase();
  const k = raw ? ALIAS[raw] ?? raw : undefined;
  if (k && k in IMAGE) return k as ChainMarkKey;
  if (id !== undefined) return BY_ID[id];
  return undefined;
}

export interface ChainMarkProps {
  /** Network key from /api/receive/networks ("solana", "tron", …). */
  networkKey?: string;
  /** Chain id (Relay ids for non-EVM). Used when `networkKey` is unknown. */
  chainId?: number;
  /** Display name, used for the lettered fallback. */
  name?: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}

/** A round network logo; a lettered disc when the network is unknown. */
export function NetworkMark({ networkKey, chainId, name, size = 24, style, className }: ChainMarkProps) {
  const key = markKey(networkKey, chainId);
  if (key) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static brand asset in /public
      <img
        src={IMAGE[key]}
        alt=""
        width={size}
        height={size}
        decoding="async"
        className={className}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", flex: "none", ...style }}
      />
    );
  }
  const letter = (name ?? networkKey ?? "?").trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        flex: "none",
        background: "currentColor",
        fontSize: size * 0.5,
        fontWeight: 700,
        ...style,
      }}
    >
      <span style={{ color: "var(--surface)", lineHeight: 1 }}>{letter}</span>
    </span>
  );
}
