// Network marks for the Receive flow — one small glyph per network so a person
// can tell Solana from Tron at a glance without reading. Base and Mantle reuse
// their real brand assets; the rest are simple monochrome marks drawn in
// `currentColor` so they sit on any surface in light and dark.
//
// Keyed by the network `key` from /api/receive/networks (falls back to the
// chain id, then to a lettered disc so an unknown network never renders blank).
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

const IMAGE: Partial<Record<ChainMarkKey, string>> = {
  base: "/brand/partners/base.svg",
  mantle: "/brand/partners/mantle.png",
};

// Relay slugs that differ from our mark names.
const ALIAS: Record<string, ChainMarkKey> = { bsc: "bnb", "bnb-chain": "bnb", eth: "ethereum", btc: "bitcoin" };

function markKey(key: string | undefined, id: number | undefined): ChainMarkKey | undefined {
  const raw = key?.toLowerCase();
  const k = raw ? ALIAS[raw] ?? raw : undefined;
  if (k && k in IMAGE) return k as ChainMarkKey;
  if (k && GLYPHS[k as ChainMarkKey]) return k as ChainMarkKey;
  if (id !== undefined) return BY_ID[id];
  return undefined;
}

// 24×24 viewBox, currentColor, no strokes thinner than 1.6 so the marks hold up at 20px.
const GLYPHS: Partial<Record<ChainMarkKey, React.ReactNode>> = {
  ethereum: (
    <>
      <path d="M12 2.5 5.5 12.6 12 16.5l6.5-3.9L12 2.5Z" fill="currentColor" opacity=".55" />
      <path d="M12 2.5v14l6.5-3.9L12 2.5Z" fill="currentColor" />
      <path d="M12 17.9 5.5 14 12 21.5l6.5-7.5L12 17.9Z" fill="currentColor" opacity=".55" />
      <path d="M12 17.9v3.6l6.5-7.5L12 17.9Z" fill="currentColor" />
    </>
  ),
  arbitrum: (
    <>
      <path d="M12 2.8 4 7.4v9.2l8 4.6 8-4.6V7.4l-8-4.6Zm0 2.3 6 3.5v6.8l-6 3.5-6-3.5V8.6l6-3.5Z" fill="currentColor" opacity=".45" />
      <path d="m10.1 8.2 2.3 4.1-1.6 2.9-2.3-4.1 1.6-2.9Zm3.8 0 3.9 6.9-1.6 2.9-3.9-6.9 1.6-2.9Zm-4 5.9L12 17.6l-1.6 2.9-2.1-3.6 1.6-2.8Z" fill="currentColor" />
    </>
  ),
  optimism: (
    <>
      <circle cx="12" cy="12" r="9.5" fill="currentColor" opacity=".18" />
      <path d="M8.3 15.2c-1.9 0-3-1.1-2.7-2.9l.4-2.3c.3-1.9 1.7-2.9 3.6-2.9 1.9 0 3 1.1 2.7 2.9l-.4 2.3c-.3 1.9-1.7 2.9-3.6 2.9Zm.3-1.6c.7 0 1.2-.4 1.4-1.3l.4-2.3c.1-.8-.2-1.3-1-1.3-.7 0-1.3.4-1.4 1.3l-.4 2.3c-.1.8.2 1.3 1 1.3Zm4.4 1.5 1.3-7.9h3.1c1.7 0 2.6.9 2.3 2.4-.3 1.7-1.5 2.6-3.3 2.6h-1.3l-.5 2.9H13Zm2.4-4.4h1c.8 0 1.2-.3 1.3-1 .1-.6-.2-.9-.9-.9h-1l-.4 1.9Z" fill="currentColor" />
    </>
  ),
  polygon: (
    <path
      d="M8 6.3 4 8.6v4.6l4 2.3 4-2.3V8.6L8 6.3Zm8 4.4-4 2.3v4.6l4 2.3 4-2.3v-4.6l-4-2.3Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  bnb: (
    <path d="m12 2.7 2.7 2.7L8.3 11.8 5.6 9.1 12 2.7Zm4.5 4.5 2.7 2.7-8.3 8.3-2.7-2.7 8.3-8.3ZM4 12l2.7-2.7L9.4 12l-2.7 2.7L4 12Zm14.6 0-2.7 2.7 2.7 2.7 2.7-2.7-2.7-2.7ZM12 21.3l-2.7-2.7 2.7-2.7 2.7 2.7-2.7 2.7ZM12 9.6l2.4 2.4-2.4 2.4-2.4-2.4L12 9.6Z" fill="currentColor" />
  ),
  avalanche: (
    <path d="M13.4 3.4c-.6-1.1-2.2-1.1-2.8 0L2.5 17.5c-.6 1.1.2 2.4 1.4 2.4h4.4c.8 0 1.5-.4 1.9-1.1l5.9-10.4-2.7-5Zm3.2 9.5c-.4-.7-1.4-.7-1.8 0l-2.8 4.8c-.4.7.1 1.6.9 1.6h6.4c.8 0 1.3-.9.9-1.6l-3.6-4.8Z" fill="currentColor" />
  ),
  solana: (
    <>
      <path d="M6.6 5.2c.2-.2.5-.3.8-.3h12.4c.5 0 .7.6.4.9l-2.7 2.7c-.2.2-.5.3-.8.3H4.3c-.5 0-.7-.6-.4-.9l2.7-2.7Z" fill="currentColor" />
      <path d="M6.6 15.1c.2-.2.5-.3.8-.3h12.4c.5 0 .7.6.4.9l-2.7 2.7c-.2.2-.5.3-.8.3H4.3c-.5 0-.7-.6-.4-.9l2.7-2.7Z" fill="currentColor" />
      <path d="M17.4 10.2c-.2-.2-.5-.3-.8-.3H4.2c-.5 0-.7.6-.4.9l2.7 2.7c.2.2.5.3.8.3h12.4c.5 0 .7-.6.4-.9l-2.7-2.7Z" fill="currentColor" opacity=".6" />
    </>
  ),
  tron: (
    <path d="M18.6 8.1 5.2 5.6a.8.8 0 0 0-.9 1.1l6.7 13.8a.8.8 0 0 0 1.4.1l7.3-10.9a.8.8 0 0 0-.4-1.2l-.7-.4Zm-1.3 1.8-3.1 2.4-1.6-3.1 4.7.7Zm-6.4-.3 1.9 3.6-1.3 5.2L7.3 8.6l3.6 1Zm3.1 5.1 3-2.3-3.9 5.9.9-3.6Z" fill="currentColor" />
  ),
  bitcoin: (
    <path d="M14.8 11.4c1-.4 1.6-1.2 1.5-2.5-.2-1.7-1.6-2.3-3.4-2.5V4h-1.6v2.3h-1.2V4H8.5v2.3H5.9v1.8h1.2c.6 0 .8.3.8.7v6.6c0 .4-.2.6-.6.6H6l-.4 2h2.9V20h1.6v-2h1.2v2h1.6v-2.1c2.3-.1 3.9-.8 4.1-3 .2-1.7-.7-2.9-2.2-3.5Zm-4.6-3.5c.9 0 3.4-.3 3.4 1.4s-2.5 1.4-3.4 1.4V7.9Zm0 8.1v-3.2c1.1 0 4 -.3 4 1.6s-2.9 1.6-4 1.6Z" fill="currentColor" />
  ),
};

export interface ChainMarkProps {
  /** Network key from /api/receive/networks ("solana", "tron", …). */
  networkKey?: string;
  /** Chain id (Relay ids for non-EVM). Used when `networkKey` is unknown. */
  chainId?: number;
  /** Display name, used for the lettered fallback + alt text. */
  name?: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}

/** A 24px-grid network mark. Brand image for Base/Mantle, monochrome glyph otherwise. */
export function NetworkMark({ networkKey, chainId, name, size = 24, style, className }: ChainMarkProps) {
  const key = markKey(networkKey, chainId);
  const img = key ? IMAGE[key] : undefined;
  if (img) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static brand asset in /public
      <img
        src={img}
        alt=""
        width={size}
        height={size}
        decoding="async"
        className={className}
        style={{ width: size, height: size, borderRadius: "50%", display: "block", flex: "none", ...style }}
      />
    );
  }
  const glyph = key ? GLYPHS[key] : undefined;
  if (glyph) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden
        focusable="false"
        className={className}
        style={{ display: "block", flex: "none", ...style }}
      >
        {glyph}
      </svg>
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

/** True when this network has a full-colour brand asset rather than a mono glyph. */
export function hasBrandMark(networkKey?: string, chainId?: number): boolean {
  const key = markKey(networkKey, chainId);
  return Boolean(key && IMAGE[key]);
}
