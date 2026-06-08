import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OG_SIZE } from "@/lib/seo";

// Brand share card (Open Graph + Twitter), 1200×630. Uses the real Stax type —
// Fraunces (display serif) + Hanken Grotesk — on the "Soft" cream paper ground.
// Deliberately minimal: one serif line does the work.
export const alt = "Stax — Invest in plain words.";
export const size = OG_SIZE;
export const contentType = "image/png";

const CREAM = "#eef1e8";
const INK = "#1a1f1c";
const SAGE = "#3f6b53";

// This route is statically prerendered at build time, where the source tree —
// including the vendored fonts in ./_og — is present on disk.
async function font(file: string) {
  return readFile(join(process.cwd(), "src/app/_og", file));
}

export default async function Image() {
  const [fraunces, hanken700, hanken500] = await Promise.all([
    font("Fraunces-600.woff"),
    font("Hanken-700.woff"),
    font("Hanken-500.woff"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "84px 96px",
          background: `radial-gradient(120% 120% at 0% 0%, #f3f5ee 0%, ${CREAM} 45%, #e4e9da 100%)`,
          color: INK,
          fontFamily: "Hanken",
        }}
      >
        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{ width: 13, height: 13, borderRadius: 99, background: SAGE }}
          />
          <div style={{ fontFamily: "Hanken", fontWeight: 700, fontSize: 38, letterSpacing: -0.5 }}>
            Stax
          </div>
        </div>

        {/* the line */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "Fraunces",
            fontSize: 132,
            lineHeight: 1.0,
            letterSpacing: -2,
          }}
        >
          <div style={{ display: "flex" }}>Invest in</div>
          <div style={{ display: "flex" }}>
            plain words<span style={{ color: SAGE }}>.</span>
          </div>
        </div>

        {/* foot */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "Hanken",
            fontWeight: 500,
            fontSize: 30,
            color: "#5c655e",
          }}
        >
          <div style={{ display: "flex" }}>stax.best</div>
          <div style={{ display: "flex", color: SAGE, fontWeight: 700 }}>
            Built on Mantle
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Fraunces", data: fraunces, weight: 600, style: "normal" },
        { name: "Hanken", data: hanken700, weight: 700, style: "normal" },
        { name: "Hanken", data: hanken500, weight: 500, style: "normal" },
      ],
    }
  );
}
