import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR, GRAD } from "../theme";
import { fraunces } from "../fonts";
import { Grade, Flash, KineticLine, SPRING, bassAt, Orbs, DotGrid } from "../kinetic";
import { type AudioData } from "@remotion/media-utils";

export const Drop: React.FC<{ audioData?: AudioData | null; start?: number }> = ({ audioData = null, start = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // beat energy → subtle pulse
  const pulse = Math.max(0, bassAt(audioData, fps, frame + start) - 0.5);

  // overshoot slam with a smooth motion blur (no Trail, so the lockup can flow)
  const slam = spring({ frame: frame - 2, fps, config: { damping: 12, stiffness: 210, mass: 0.9 } });
  const lockScale = interpolate(slam, [0, 1], [1.5, 1]) * (1 + pulse * 0.3);
  const lockOp = interpolate(slam, [0, 0.18, 1], [0, 1, 1], { extrapolateRight: "clamp" });
  const lockBlur = interpolate(slam, [0, 0.5, 1], [20, 5, 0], { extrapolateRight: "clamp" });

  // violent one-frame shockwave ring
  const burst = spring({ frame: frame - 2, fps, config: SPRING.VIOLENT });
  const ringScale = interpolate(burst, [0, 1], [0, 17]);
  const ringOpacity = interpolate(burst, [0, 0.25, 1], [0.6, 0.34, 0]);

  // lingering sage bloom, brightening on the beat
  const bloom = interpolate(frame, [18, 40], [0, 0.16], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) + pulse * 0.18;

  return (
    <Grade act="drop">
      <DotGrid />
      <Orbs />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 1100, height: 1100, marginLeft: -550, marginTop: -550, borderRadius: "50%", background: "radial-gradient(circle, rgba(108,179,143,0.5), rgba(108,179,143,0) 62%)", opacity: bloom, filter: "blur(8px)" }} />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 240, height: 240, marginLeft: -120, marginTop: -120, borderRadius: "50%", background: GRAD.hero, transform: `scale(${ringScale})`, opacity: ringOpacity, filter: "blur(2px)" }} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: lockOp, transform: `scale(${lockScale})`, filter: `blur(${lockBlur}px)`, zIndex: 2 }}>
          {/* brand lockup: logo + wordmark, centered to each other */}
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <Img src={staticFile("brand/stax-logo.png")} style={{ width: 196, height: 196, marginRight: -22 }} />
            <span style={{ fontFamily: fraunces, fontWeight: 600, fontSize: 150, color: COLOR.ink, letterSpacing: -3, lineHeight: 1.05 }}>Stax</span>
          </div>
          {/* tagline, centered under the lockup */}
          <div style={{ marginTop: -2 }}>
            <KineticLine words={[{ t: "changes" }, { t: "that.", hl: true }]} delay={26} stagger={4} size={64} weight={700} justify="center" />
          </div>
        </div>
      </AbsoluteFill>

      <Flash at={0} dur={12} peak={1} color="#fff6ec" />
    </Grade>
  );
};
