"use client";

// Wallet marks for "From another wallet": simple monochrome glyphs we drew
// ourselves (geometric approximations, not brand files) under
// /public/icons/wallets. Rendered through a CSS mask so the glyph takes
// `currentColor` and follows the theme like a Lucide icon would.
import type { CSSProperties } from "react";

export type WalletMarkKey = "metamask" | "coinbase" | "rainbow" | "walletconnect";

export const WALLET_MARKS: { key: WalletMarkKey; name: string }[] = [
  { key: "metamask", name: "MetaMask" },
  { key: "coinbase", name: "Coinbase Wallet" },
  { key: "rainbow", name: "Rainbow" },
  { key: "walletconnect", name: "WalletConnect" },
];

export function WalletMark({ mark, size = 22, style }: { mark: WalletMarkKey; size?: number; style?: CSSProperties }) {
  const url = `url(/icons/wallets/${mark}.svg)`;
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        width: size,
        height: size,
        flex: "none",
        background: "currentColor",
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        ...style,
      }}
    />
  );
}

/** A row of the wallets people arrive with, each on a quiet disc, named once for screen readers. */
export function WalletMarkRow({ size = 44 }: { size?: number }) {
  return (
    <ul
      aria-label={`Works with ${WALLET_MARKS.map((w) => w.name).join(", ")}`}
      style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 10 }}
    >
      {WALLET_MARKS.map((w) => (
        <li
          key={w.key}
          title={w.name}
          style={{
            width: size,
            height: size,
            borderRadius: 99,
            display: "grid",
            placeItems: "center",
            background: "var(--surface-2)",
            color: "var(--ink-2)",
            boxShadow: "inset 0 0 0 1px var(--line-2)",
          }}
        >
          <WalletMark mark={w.key} size={Math.round(size * 0.5)} />
        </li>
      ))}
    </ul>
  );
}
