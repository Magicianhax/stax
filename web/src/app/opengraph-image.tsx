import { ImageResponse } from "next/og";
import { OG_SIZE, SITE_TAGLINE } from "@/lib/seo";

// Dynamically generated 1200×630 share card (Open Graph + Twitter). Text-only by
// design — no external fonts or asset fetches, so it can never fail at build or
// request time. Brand "paper" palette: cream ground, ink type, sage accent.
export const alt = "Stax — Invest in plain words. Real companies, no seed phrase.";
export const size = OG_SIZE;
export const contentType = "image/png";

const CREAM = "#eef1e8";
const INK = "#15191a";
const INK_SOFT = "#3b4440";
const SAGE = "#3f6b53";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: `linear-gradient(135deg, ${CREAM} 0%, #e6ebdd 100%)`,
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 76,
              height: 76,
              borderRadius: 20,
              background: SAGE,
              color: CREAM,
              fontSize: 46,
              fontWeight: 800,
            }}
          >
            S
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: -1 }}>Stax</div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 92,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: -2,
              maxWidth: 1000,
            }}
          >
            {`${SITE_TAGLINE}.`}
          </div>
          <div style={{ fontSize: 38, color: INK_SOFT, fontWeight: 500, maxWidth: 940 }}>
            Buy real companies with Vera, your investing assistant. Email login,
            no seed phrase, fees on us.
          </div>
        </div>

        {/* Footer row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 30,
            color: INK_SOFT,
            fontWeight: 600,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 12, height: 12, borderRadius: 99, background: SAGE }} />
            <div>Built on Mantle</div>
          </div>
          <div style={{ color: SAGE, fontWeight: 700 }}>stax.best</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
