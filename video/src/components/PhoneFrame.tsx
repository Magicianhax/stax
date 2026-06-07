import React from "react";
import { Img, interpolate, useCurrentFrame } from "remotion";

// Screen capture native size (Playwright viewport): 440 x 956.
const SCREEN_RATIO = 440 / 956;

export const PhoneFrame: React.FC<{
  children?: React.ReactNode;
  src?: string;
  height: number;
  idle?: boolean;
  style?: React.CSSProperties;
}> = ({ children, src, height, idle = true, style }) => {
  const frame = useCurrentFrame();
  const screenW = Math.round(height * SCREEN_RATIO);
  const bezel = Math.round(height * 0.016);
  const radius = Math.round(height * 0.062);
  const totalW = screenW + bezel * 2;
  const totalH = height + bezel * 2;

  // idle float + subtle 3D tilt — keeps the phone alive
  const floatY = idle ? Math.sin(frame * 0.045) * 9 : 0;
  const rotY = idle ? Math.sin(frame * 0.03) * 3.2 : 0;
  const rotX = idle ? Math.cos(frame * 0.037) * 1.8 : 0;

  // glass glare sweep — crosses every ~5s, then rests
  const period = 165;
  const gp = (frame % period) / period;
  const glareX = interpolate(gp, [0, 0.45, 1], [-55, 165, 165]);
  const glareO = interpolate(gp, [0, 0.18, 0.45, 1], [0, 0.55, 0, 0]);

  return (
    <div style={{ perspective: 1700, ...style }}>
      <div
        style={{
          position: "relative",
          width: totalW,
          height: totalH,
          borderRadius: radius + bezel,
          transform: `translateY(${floatY}px) rotateY(${rotY}deg) rotateX(${rotX}deg)`,
          transformStyle: "preserve-3d",
          background: "linear-gradient(150deg, #444c52 0%, #161b1f 38%, #0b0f12 100%)",
          padding: bezel,
          boxShadow: `0 2px 5px rgba(40,52,38,0.30), 0 ${44 + floatY}px 96px rgba(40,52,38,0.34), inset 0 1px 0 rgba(255,255,255,0.20), inset 0 0 0 1.5px rgba(255,255,255,0.06)`,
        }}
      >
        {/* side buttons */}
        <div style={{ position: "absolute", left: -2, top: height * 0.21, width: 3, height: height * 0.045, borderRadius: 2, background: "#0a0d0f" }} />
        <div style={{ position: "absolute", left: -2, top: height * 0.29, width: 3, height: height * 0.085, borderRadius: 2, background: "#0a0d0f" }} />
        <div style={{ position: "absolute", right: -2, top: height * 0.25, width: 3, height: height * 0.12, borderRadius: 2, background: "#0a0d0f" }} />

        <div
          style={{
            position: "relative",
            width: screenW,
            height,
            borderRadius: radius,
            overflow: "hidden",
            background: "#eef1e8",
          }}
        >
          {src ? <Img src={src} style={{ width: screenW, height, objectFit: "cover", display: "block" }} /> : null}
          {children}

          {/* static top reflection sheen */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(158deg, rgba(255,255,255,0.16), rgba(255,255,255,0) 28%)", pointerEvents: "none" }} />
          {/* animated glass glare sweep */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${glareX}%`,
              width: "42%",
              background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.5), transparent)",
              transform: "skewX(-16deg)",
              opacity: glareO,
              pointerEvents: "none",
            }}
          />

          {/* dynamic island */}
          <div
            style={{
              position: "absolute",
              top: height * 0.018,
              left: "50%",
              transform: "translateX(-50%)",
              width: screenW * 0.3,
              height: height * 0.026,
              borderRadius: 999,
              background: "rgba(11,15,14,0.96)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingRight: 7,
            }}
          >
            <div style={{ width: height * 0.011, height: height * 0.011, borderRadius: "50%", background: "rgba(90,130,110,0.55)" }} />
          </div>
        </div>
      </div>
    </div>
  );
};
