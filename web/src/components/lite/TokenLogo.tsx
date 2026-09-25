"use client";

// TokenLogo — a real asset/token logo as a round badge, with a graceful coloured-monogram
// fallback if the image fails to load. One consistent treatment for cash, send chips,
// transaction rows, etc. On BSC a tokenized stock's logo depends on which issuer minted it
// (bStock and Ondo brand the same ticker differently — lib/assetLogo.ts); everywhere else it's
// exactly displayFor(symbol).logo, same as before `venue` existed.
import { useState } from "react";
import { assetLogo } from "@/lib/assetLogo";
import { useChain } from "@/lib/chains/active";
import type { RwaPlatform } from "@/lib/chains";
import { displayFor } from "@/lib/displayAssets";

export function TokenLogo({
  symbol,
  name,
  size = 38,
  logo,
  venue,
}: {
  symbol: string;
  name?: string;
  size?: number;
  /** Override the resolved logo (e.g. lib/tokenLogos for receivable tokens). */
  logo?: string;
  /** BSC only: whose mint this row is for (a twin holding, a VenuePicker row). Ignored off BSC. */
  venue?: RwaPlatform;
}) {
  const chain = useChain();
  const d = displayFor(symbol, name);
  const [failed, setFailed] = useState(false);
  const src = logo ?? assetLogo(chain, symbol, venue);
  const showImg = src && !failed;

  if (showImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote/SVG token logos, no Image loader
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: "50%", flex: "none", display: "block", objectFit: "cover" }}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        display: "grid",
        placeItems: "center",
        background: d.color,
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.42,
      }}
    >
      {d.glyph ?? (d.name || symbol)[0]?.toUpperCase()}
    </span>
  );
}
