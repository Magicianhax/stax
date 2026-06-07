import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Trail } from "@remotion/motion-blur";
import { COLOR, GRAD, GLASS, GRADES } from "../theme";
import { fraunces, hanken } from "../fonts";
import { Grade, useSlam, useFlyIn, SPRING, bassAt, drift, Orbs, DotGrid } from "../kinetic";
import { type AudioData } from "@remotion/media-utils";
import { ArrowRight } from "../components/Icons";

const S = GRADES.stats; // dark grade colors

type Align = { v: "flex-start" | "center" | "flex-end"; h: "flex-start" | "center" | "flex-end"; pad: string };
type P = { a: string; b: string; start: number; end: number; align: Align };

const CENTER: Align = { v: "center", h: "center", pad: "0" };
const PUNCHES: P[] = [
  { a: "From", b: "$1", start: 0, end: 28, align: CENTER },
  { a: "Zero", b: "gas", start: 24, end: 52, align: CENTER },
  { a: "Signed", b: "on-chain", start: 48, end: 76, align: CENTER },
  { a: "Real", b: "shares", start: 72, end: 95, align: CENTER },
];

const PunchInner: React.FC<Omit<P, "align">> = ({ a, b, start, end }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - start;
  const dur = end - start;
  const p = spring({ frame: f, fps, config: SPRING.AUTHORITATIVE });
  const exit = interpolate(f, [dur - 7, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(p, [0, 1], [1.4, 1]) * interpolate(exit, [0, 1], [1, 1.08]);
  const opacity = interpolate(p, [0, 0.2, 1], [0, 1, 1], { extrapolateRight: "clamp" }) * interpolate(exit, [0, 1], [1, 0]);
  const big = b === "shares" || b === "on-chain" ? 184 : 208;
  return (
    <div style={{ display: "flex", gap: 30, alignItems: "baseline", transform: `scale(${scale})`, opacity, filter: `blur(${exit * 9}px)` }}>
      <span style={{ fontFamily: hanken, fontWeight: 800, fontSize: big, color: S.ink, letterSpacing: "-0.04em" }}>{a}</span>
      <span style={{ fontFamily: fraunces, fontWeight: 600, fontSize: big, color: S.hl, letterSpacing: "-0.03em" }}>{b}</span>
    </div>
  );
};

const Punch: React.FC<P> = ({ align, ...rest }) => {
  const frame = useCurrentFrame();
  if (frame < rest.start - 2 || frame >= rest.end + 1) return null;
  return (
    <Trail layers={5} lagInFrames={1} trailOpacity={0.5}>
      <AbsoluteFill style={{ justifyContent: align.v, alignItems: align.h, padding: align.pad }}>
        <PunchInner {...rest} />
      </AbsoluteFill>
    </Trail>
  );
};

export const Stats: React.FC<{ audioData?: AudioData | null; start?: number }> = ({ audioData = null, start = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const glow = Math.max(0, bassAt(audioData, fps, frame + start) - 0.45) * 0.8;
  return (
    <Grade act="stats">
      {/* beat-reactive sage glow behind the punches */}
      <AbsoluteFill style={{ background: "radial-gradient(900px 620px at 50% 50%, rgba(127,212,171,0.5), transparent 70%)", opacity: glow, mixBlendMode: "screen", pointerEvents: "none" }} />
      {PUNCHES.map((p) => (
        <Punch key={p.a} {...p} />
      ))}
    </Grade>
  );
};

const END_STOCKS = [
  { f: "AAPL", x: 12, y: 20, s: 78 },
  { f: "NVDA", x: 87, y: 23, s: 84 },
  { f: "META", x: 20, y: 81, s: 66 },
  { f: "GOOGL", x: 85, y: 78, s: 74 },
  { f: "TSLA", x: 50, y: 11, s: 60 },
  { f: "SPY", x: 92, y: 51, s: 60 },
  { f: "HOOD", x: 8, y: 49, s: 66 },
  { f: "MSTR", x: 63, y: 89, s: 58 },
];

export const End: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = useSlam(2, 1.5, true);
  const word = useSlam(7, 1.4, true);
  const tag = useFlyIn(20, "up", 28);
  const url = useFlyIn(32, "up", 24);
  const handle = useFlyIn(42, "up", 20);

  const sweep = interpolate(frame, [26, 74], [-120, 240], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const breathe = 1 + Math.sin(frame * 0.05) * 0.006;
  const glow = 0.25 + Math.sin(frame * 0.06) * 0.12;
  const bloom = interpolate(frame, [0, 30], [0, 0.12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Grade act="end">
      <DotGrid />
      <Orbs />
      {/* scattered, blurred company tiles — bookends the intro */}
      {END_STOCKS.map((w, i) => {
        const appear = interpolate(frame, [i * 2, i * 2 + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const dx = drift(`ex${i}`, frame * 0.02, 9);
        const dy = drift(`ey${i}`, frame * 0.025, 9);
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
              transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) rotate(${(i % 2 ? -1 : 1) * 4}deg)`,
              opacity: appear * 0.3,
              filter: "blur(3.5px)",
            }}
          />
        );
      })}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ position: "absolute", width: 1000, height: 1000, borderRadius: "50%", background: "radial-gradient(circle, rgba(108,179,143,0.4), rgba(108,179,143,0) 60%)", opacity: bloom, filter: "blur(10px)" }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, transform: `scale(${breathe})` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0, position: "relative", overflow: "hidden" }}>
            <Img src={staticFile("brand/stax-logo.png")} style={{ width: 170, height: 170, marginRight: -18, ...logo }} />
            <span style={{ fontFamily: fraunces, fontWeight: 600, fontSize: 140, color: COLOR.ink, letterSpacing: -2, ...word }}>Stax</span>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${sweep}px`, width: 80, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)", transform: "skewX(-18deg)", pointerEvents: "none" }} />
          </div>
          <div style={{ fontFamily: fraunces, fontWeight: 600, fontSize: 62, color: COLOR.ink2, ...tag }}>Invest in plain words.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 38px", borderRadius: 999, background: GRAD.hero, color: COLOR.white, fontFamily: hanken, fontWeight: 700, fontSize: 44, boxShadow: `0 18px 40px rgba(63,135,101,0.35), 0 0 ${24 * glow}px rgba(63,135,101,${glow * 1.4})`, ...url }}>
            stax.best <ArrowRight size={34} color={COLOR.white} />
          </div>
          <div style={{ fontFamily: hanken, fontWeight: 500, fontSize: 30, color: COLOR.ink2, padding: "10px 22px", borderRadius: 999, background: GLASS.bg, border: `1px solid ${GLASS.stroke}`, ...handle }}>
            @stax_market
          </div>
        </div>
      </AbsoluteFill>
    </Grade>
  );
};
