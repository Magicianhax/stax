import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLOR } from "../theme";
import { hanken } from "../fonts";
import { Grade, KineticLine, CameraPush, drift } from "../kinetic";

const HEADLINE: { t: string; hl?: boolean }[] = [
  { t: "Investing" }, { t: "always" }, { t: "felt" }, { t: "like" }, { t: "a" },
  { t: "club", hl: true }, { t: "you" }, { t: "weren't", hl: true }, { t: "invited", hl: true }, { t: "to." },
];

// Real company tiles, scattered faded around the headline band (kept clear, y 40-60).
const STOCKS = [
  { f: "NVDA", x: 15, y: 22, s: 78, d: 108 },
  { f: "AAPL", x: 85, y: 18, s: 70, d: 124 },
  { f: "META", x: 49, y: 12, s: 60, d: 150 },
  { f: "SPY", x: 91, y: 33, s: 64, d: 170 },
  { f: "HOOD", x: 9, y: 32, s: 68, d: 188 },
  { f: "GOOGL", x: 83, y: 73, s: 72, d: 206 },
  { f: "TSLA", x: 24, y: 81, s: 64, d: 224 },
  { f: "MSTR", x: 63, y: 87, s: 60, d: 240 },
];

// A few jargon terms for texture, off the headline band
const JARGON = [
  { t: "P/E ratio", x: 33, y: 25, s: 42, d: 132 },
  { t: "slippage", x: 70, y: 24, s: 42, d: 162 },
  { t: "basis points", x: 31, y: 75, s: 42, d: 198 },
  { t: "market cap", x: 70, y: 76, s: 42, d: 232 },
];

export const Build: React.FC = () => {
  const frame = useCurrentFrame();
  const shakeAmt = interpolate(frame, [280, 340], [0, 8], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const freeze = frame > 338 ? 0 : 1;
  const shake = Math.sin(frame * 1.8) * shakeAmt * freeze;
  const fade = interpolate(frame, [300, 336], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Grade act="build">
      <CameraPush from={1.02} to={1.14} ease="inout">
        {/* scattered company tiles */}
        {STOCKS.map((w, i) => {
          const appear = interpolate(frame, [w.d, w.d + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const fromLeft = w.x < 50;
          const slide = interpolate(frame, [w.d, w.d + 16], [fromLeft ? -90 : 90, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const dx = drift(`sx${i}`, frame * 0.018, 8);
          const dy = drift(`sy${i}`, frame * 0.02, 8);
          return (
            <Img
              key={w.f}
              src={staticFile(`brand/stocks/${w.f}.png`)}
              style={{
                position: "absolute",
                left: `${w.x}%`,
                top: `${w.y}%`,
                width: w.s,
                height: w.s,
                borderRadius: w.s * 0.26,
                transform: `translate(-50%,-50%) translate(${slide + dx}px, ${dy}px) rotate(${(i % 2 ? -1 : 1) * 3}deg)`,
                opacity: appear * fade * 0.5,
                boxShadow: "0 8px 20px rgba(40,52,38,0.10)",
              }}
            />
          );
        })}

        {/* a little jargon for texture */}
        {JARGON.map((w, i) => {
          const appear = interpolate(frame, [w.d, w.d + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const fromLeft = w.x < 50;
          const slide = interpolate(frame, [w.d, w.d + 16], [fromLeft ? -70 : 70, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const dx = drift(`jx${i}`, frame * 0.018, 7);
          const dy = drift(`jy${i}`, frame * 0.02, 7);
          return (
            <span
              key={w.t}
              style={{
                position: "absolute",
                left: `${w.x}%`,
                top: `${w.y}%`,
                transform: `translate(-50%,-50%) translate(${slide + dx}px, ${dy}px) rotate(${(i % 2 ? -1 : 1) * 2}deg)`,
                fontFamily: hanken,
                fontWeight: 600,
                fontSize: w.s,
                color: COLOR.ink2,
                opacity: appear * fade * 0.34,
                whiteSpace: "nowrap",
              }}
            >
              {w.t}
            </span>
          );
        })}

        {/* headline — the single in-focus plane */}
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 220px", transform: `translateX(${shake}px)` }}>
          <div style={{ maxWidth: 1320 }}>
            <KineticLine words={HEADLINE} delay={20} stagger={5} size={104} />
          </div>
        </AbsoluteFill>
      </CameraPush>
    </Grade>
  );
};
