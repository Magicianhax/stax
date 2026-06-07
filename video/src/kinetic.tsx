import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { visualizeAudio, type AudioData } from "@remotion/media-utils";
import { COLOR, GRADES, type GradeKey } from "./theme";
import { hanken } from "./fonts";

/** Low-frequency (bass) energy 0..1 at a given frame. Safe if audioData is missing. */
export const bassAt = (audioData: AudioData | null | undefined, fps: number, frame: number): number => {
  if (!audioData) return 0;
  try {
    const v = visualizeAudio({ fps, frame: Math.max(0, Math.round(frame)), audioData, numberOfSamples: 32 });
    return (v[0] + v[1] + v[2] + v[3]) / 4;
  } catch {
    return 0;
  }
};

// One motion vocabulary, three presets. SMOOTH for type/secondary, AUTHORITATIVE
// for confident single-overshoot settles, HERO for the big phone, VIOLENT reserved
// for the Drop ring only.
export const SPRING = {
  SMOOTH: { damping: 200 },
  AUTHORITATIVE: { damping: 26, stiffness: 170, mass: 1 },
  HERO: { damping: 18, stiffness: 90, mass: 1.4 },
  VIOLENT: { damping: 11, stiffness: 220, mass: 0.8 },
} as const;

/** Organic drift via Perlin noise (never visibly loops, unlike Math.sin). */
export const drift = (seed: string, t: number, amp: number) => noise2D(seed, t, 0) * amp;

/** Confident single-overshoot slam (no fake blur — wrap in <Trail> for motion blur). */
export const useSlam = (delay = 0, fromScale = 1.4, anticipation = false) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - delay;
  const p = spring({ frame: f, fps, config: SPRING.AUTHORITATIVE });
  // tiny pre-scale dip before the spring fires
  const ant = anticipation ? interpolate(f, [-3, 0], [0.985, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return {
    opacity: interpolate(p, [0, 0.2, 1], [0, 1, 1], { extrapolateRight: "clamp" }),
    transform: `scale(${interpolate(p, [0, 1], [fromScale, 1]) * ant})`,
  };
};

/** Fly-in from a direction (no fake blur). */
export const useFlyIn = (delay = 0, dir: "up" | "down" | "left" | "right" = "up", dist = 80) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: SPRING.AUTHORITATIVE });
  const d = interpolate(p, [0, 1], [dist, 0]);
  const axis = dir === "up" || dir === "down" ? "Y" : "X";
  const sign = dir === "down" || dir === "right" ? -1 : 1;
  return {
    opacity: interpolate(p, [0, 0.25, 1], [0, 1, 1], { extrapolateRight: "clamp" }),
    transform: `translate${axis}(${d * sign}px)`,
  };
};

export const useCountUp = (to: number, delay = 0, dur = 22) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [delay, delay + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return to * (1 - Math.pow(1 - p, 3));
};

/** Film grain — coarse, soft-light blended, large seed pool so it never strobes. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.06 }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 8;
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "soft-light", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={`grain${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves={2} seed={seed} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.3 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(125% 125% at 50% 46%, transparent 50%, rgba(14,20,15,${strength}) 100%)`,
      pointerEvents: "none",
    }}
  />
);

/** Per-act graded canvas: bg + unified grain + vignette. Wrap each scene in this. */
export const Grade: React.FC<{ act: GradeKey; children?: React.ReactNode }> = ({ act, children }) => {
  const g = GRADES[act];
  return (
    <AbsoluteFill style={{ background: g.bg }}>
      {children}
      <Grain opacity={g.dark ? 0.08 : 0.06} />
      <Vignette strength={g.vignette} />
    </AbsoluteFill>
  );
};

/** Soft out-of-focus sage/teal orbs that slowly drift — atmosphere + key light. */
export const Orbs: React.FC = () => {
  const frame = useCurrentFrame();
  const orbs = [
    { c: "rgba(108,179,143,0.30)", x: 14, y: 18, r: 660, sx: 0.012, sy: 0.010 },
    { c: "rgba(63,143,134,0.22)", x: 86, y: 80, r: 600, sx: 0.010, sy: 0.013 },
    { c: "rgba(124,200,160,0.18)", x: 74, y: 20, r: 460, sx: 0.014, sy: 0.009 },
  ];
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      {orbs.map((o, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${o.x}%`,
            top: `${o.y}%`,
            width: o.r,
            height: o.r,
            marginLeft: -o.r / 2,
            marginTop: -o.r / 2,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${o.c}, transparent 65%)`,
            transform: `translate(${drift(`ox${i}`, frame * o.sx, 70)}px, ${drift(`oy${i}`, frame * o.sy, 70)}px)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Faint dotted blueprint grid, masked to fade at the edges. */
export const DotGrid: React.FC<{ color?: string; opacity?: number; size?: number }> = ({
  color = "rgba(40,52,38,0.5)",
  opacity = 0.1,
  size = 34,
}) => (
  <AbsoluteFill
    style={{
      opacity,
      backgroundImage: `radial-gradient(${color} 1.4px, transparent 1.4px)`,
      backgroundSize: `${size}px ${size}px`,
      pointerEvents: "none",
      maskImage: "radial-gradient(125% 125% at 50% 50%, black 52%, transparent 100%)",
      WebkitMaskImage: "radial-gradient(125% 125% at 50% 50%, black 52%, transparent 100%)",
    }}
  />
);

export const Flash: React.FC<{ at: number; dur?: number; color?: string; peak?: number }> = ({
  at,
  dur = 9,
  color = "#ffffff",
  peak = 0.92,
}) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + 2, at + dur], [0, peak, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: "none" }} />;
};

/** A warm/sage light leak that sweeps across a cut — analog production value on the joins. */
export const LightLeak: React.FC<{ at: number; dur?: number; from?: "left" | "right"; tint?: string }> = ({
  at,
  dur = 26,
  from = "right",
  tint = "rgba(255,240,214,",
}) => {
  const f = useCurrentFrame();
  if (f < at || f > at + dur) return null;
  const p = interpolate(f, [at, at + dur], [0, 1]);
  const o = interpolate(p, [0, 0.32, 1], [0, 0.55, 0]);
  const x = from === "right" ? interpolate(p, [0, 1], [115, -45]) : interpolate(p, [0, 1], [-45, 115]);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "screen", opacity: o }}>
      <div
        style={{
          position: "absolute",
          top: "-25%",
          bottom: "-25%",
          left: `${x}%`,
          width: "60%",
          background: `linear-gradient(100deg, transparent, ${tint}0.95) 45%, ${tint}0.55) 62%, transparent)`,
          transform: "skewX(-13deg)",
          filter: "blur(34px)",
        }}
      />
    </AbsoluteFill>
  );
};

/** Camera push with easing (linear zoom is the classic mechanical tell). */
export const CameraPush: React.FC<{ from?: number; to?: number; ease?: "in" | "out" | "inout"; children: React.ReactNode }> = ({
  from = 1,
  to = 1.06,
  ease = "out",
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const easing = ease === "in" ? Easing.in(Easing.cubic) : ease === "inout" ? Easing.inOut(Easing.cubic) : Easing.out(Easing.cubic);
  const s = interpolate(frame, [0, durationInFrames], [from, to], { easing, extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ transform: `scale(${s})` }}>{children}</AbsoluteFill>;
};

/** Expanding tap ripple — reads as a finger tap on the screen. */
export const TapRipple: React.FC<{ at: number; x: string; y: string; size?: number }> = ({ at, x, y, size = 84 }) => {
  const f = useCurrentFrame();
  if (f < at || f > at + 24) return null;
  const p = interpolate(f, [at, at + 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(p, [0, 1], [0.25, 1.5]);
  const op = interpolate(p, [0, 0.3, 1], [0, 0.5, 0]);
  const dot = interpolate(p, [0, 0.4, 1], [0.85, 0.5, 0]);
  const d = size * 0.22;
  return (
    <>
      <div style={{ position: "absolute", left: x, top: y, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: "50%", border: "2.5px solid rgba(63,135,101,0.85)", background: "rgba(63,135,101,0.12)", transform: `scale(${scale})`, opacity: op, pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: x, top: y, width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2, borderRadius: "50%", background: "rgba(63,135,101,0.8)", opacity: dot, pointerEvents: "none" }} />
    </>
  );
};

type Word = { t: string; hl?: boolean };
/** Kinetic line: each word wipes up (clip-path) with a stagger; hl words punch heavier. */
export const KineticLine: React.FC<{
  words: Word[];
  delay?: number;
  stagger?: number;
  size: number;
  weight?: number;
  justify?: "center" | "flex-start";
  color?: string;
  hlColor?: string;
}> = ({ words, delay = 0, stagger = 4, size, weight = 800, justify = "center", color = COLOR.ink, hlColor = COLOR.primaryD }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: `${size * 0.04}px ${size * 0.24}px`, justifyContent: justify, lineHeight: 1.16, letterSpacing: "-0.02em" }}>
      {words.map((w, i) => {
        const p = spring({ frame: frame - delay - i * stagger, fps, config: SPRING.SMOOTH });
        // clip from the bottom, but leave headroom (18%) so descenders are never chopped
        const clip = interpolate(p, [0, 1], [118, 0]);
        const y = interpolate(p, [0, 1], [size * 0.5, 0]);
        const track = interpolate(p, [0, 1], [0.06, w.hl ? -0.01 : 0]);
        return (
          <span
            key={i}
            style={{
              fontFamily: hanken,
              fontWeight: w.hl ? 900 : weight,
              fontSize: w.hl ? size * 1.04 : size,
              color: w.hl ? hlColor : color,
              lineHeight: 1.16,
              paddingBottom: `${Math.round(size * 0.16)}px`,
              clipPath: `inset(0 0 ${clip}% 0)`,
              transform: `translateY(${y}px)`,
              letterSpacing: `${track}em`,
              display: "inline-block",
            }}
          >
            {w.t}
          </span>
        );
      })}
    </div>
  );
};
