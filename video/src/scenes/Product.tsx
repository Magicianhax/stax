import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { PhoneFrame } from "../components/PhoneFrame";
import { COLOR, GLASS, GRAD } from "../theme";
import { fraunces, hanken } from "../fonts";
import { Grade, KineticLine, useSlam, useCountUp, TapRipple, SPRING, Orbs, DotGrid } from "../kinetic";

const PHONE_H = 760;
const EASE = { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const flyConfig = { damping: 16, mass: 1.2, stiffness: 80 };

const Screen: React.FC<{ src: string; x: number; opacity?: number }> = ({ src, x, opacity = 1 }) => (
  <Img src={staticFile(src)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity, transform: `translateX(${x}%)` }} />
);

// 3D flying zoom-in from the left; rests at an angled hero pose. Trail (outside) adds motion blur.
const FlyPhone: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: flyConfig });
  const settle = p;
  const scale = interpolate(p, [0, 1], [0.4, 1]);
  const x = interpolate(p, [0, 1], [-760, 0]);
  const y = interpolate(p, [0, 1], [-50, 0]) + Math.sin(frame * 0.04) * 6 * settle;
  const rotY = interpolate(p, [0, 1], [92, 22]) + Math.sin(frame * 0.03) * 1.6 * settle;
  const rotX = interpolate(p, [0, 1], [20, 7]) + Math.cos(frame * 0.05) * 0.9 * settle;
  // smooth directional motion blur on the fly-in only (no laddered Trail, no fly-out)
  const blur = interpolate(p, [0, 0.5, 1], [26, 7, 0], { extrapolateRight: "clamp" });
  return (
    <div style={{ perspective: 1500 }}>
      <div style={{ transformStyle: "preserve-3d", transform: `translateX(${x}px) translateY(${y}px) scale(${scale}) rotateY(${rotY}deg) rotateX(${rotX}deg)`, filter: `blur(${blur}px)` }}>
        {children}
      </div>
    </div>
  );
};

// Directional ground-contact shadow under the phone so it rests on a plane.
const ContactShadow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: flyConfig });
  const op = interpolate(p, [0, 1], [0, 0.34]);
  const sx = interpolate(p, [0, 1], [0.5, 1]);
  return (
    <div
      style={{
        position: "absolute",
        bottom: -28,
        left: "50%",
        width: 460,
        height: 86,
        marginLeft: -230,
        transform: `translateX(34px) scaleX(${sx})`,
        borderRadius: "50%",
        background: "radial-gradient(ellipse at center, rgba(34,48,34,0.55), rgba(34,48,34,0) 70%)",
        opacity: op,
        filter: "blur(14px)",
      }}
    />
  );
};

export const Product: React.FC = () => {
  const frame = useCurrentFrame();
  const goalX = interpolate(frame, [0, 1, 88, 102], [0, 0, 0, -100], EASE);
  const planX = interpolate(frame, [88, 102, 198, 212], [100, 0, 0, -100], EASE);
  const successX = interpolate(frame, [198, 212, 320, 321], [100, 0, 0, 0], EASE);

  return (
    <Grade act="product">
      <DotGrid />
      <Orbs />
      {/* soft floor so the phone rests on a surface */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, transparent 60%, rgba(40,52,38,0.06) 100%)" }} />
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-start", paddingLeft: 165, paddingRight: 90, gap: 80 }}>
        <div style={{ position: "relative", width: 380, height: PHONE_H }}>
          <ContactShadow />
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <FlyPhone>
              <PhoneFrame height={PHONE_H} idle={false}>
                <Screen src="screens/stax-goal.png" x={goalX} />
                {/* goal text fills in right when the suggestion is tapped */}
                <Screen src="screens/stax-goal-filled.png" x={goalX} opacity={interpolate(frame, [40, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
                <Screen src="screens/stax-plan.png" x={planX} />
                <Screen src="screens/stax-success.png" x={successX} />
                <TapRipple at={36} x="32%" y="55%" size={58} />
                <TapRipple at={80} x="50%" y="93%" size={66} />
                <TapRipple at={186} x="50%" y="93%" size={66} />
              </PhoneFrame>
            </FlyPhone>
          </AbsoluteFill>
        </div>

        {/* copy column */}
        <div style={{ position: "relative", flex: 1, height: PHONE_H }}>
          <Copy win={[0, 8, 82, 94]}>
            <KineticLine words={[{ t: "Tell" }, { t: "Vera" }]} delay={6} stagger={4} size={88} justify="flex-start" />
            <KineticLine words={[{ t: "what" }, { t: "you" }, { t: "want.", hl: true }]} delay={12} stagger={4} size={88} justify="flex-start" />
            <Sub>In plain words. No tickers, no jargon.</Sub>
          </Copy>

          <Copy win={[92, 104, 190, 202]}>
            <KineticLine words={[{ t: "A" }, { t: "real" }, { t: "plan." }]} delay={96} stagger={4} size={88} justify="flex-start" />
            <KineticLine words={[{ t: "In" }, { t: "seconds.", hl: true }]} delay={104} stagger={4} size={88} justify="flex-start" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 28 }}>
              {[{ t: "Nvidia", v: 30, f: "NVDA" }, { t: "Apple", v: 25, f: "AAPL" }, { t: "S&P 500", v: 25, f: "SPY" }, { t: "Safe $", v: 20, f: "SAFE" }].map((c, i) => (
                <Chip key={c.t} label={c.t} value={c.v} logo={c.f} delay={112 + i * 7} />
              ))}
            </div>
          </Copy>

          <Copy win={[202, 214, 290, 300]}>
            <Check />
            <KineticLine words={[{ t: "One" }, { t: "tap." }]} delay={208} stagger={4} size={88} justify="flex-start" />
            <KineticLine words={[{ t: "Invested.", hl: true }]} delay={214} stagger={4} size={88} justify="flex-start" />
            <Sub>Gas-free, and signed on-chain.</Sub>
          </Copy>
        </div>
      </AbsoluteFill>
    </Grade>
  );
};

const Copy: React.FC<{ win: number[]; children: React.ReactNode }> = ({ win, children }) => {
  const f = useCurrentFrame();
  const op = interpolate(f, win, [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(f, [win[0], win[1]], [22, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", opacity: op, transform: `translateY(${y}px)` }}>
      <div>{children}</div>
    </AbsoluteFill>
  );
};

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: hanken, fontWeight: 500, fontSize: 34, color: COLOR.ink2, marginTop: 22 }}>{children}</div>
);

const Check: React.FC = () => {
  const slam = useSlam(204, 1.9);
  return (
    <div style={{ width: 80, height: 80, borderRadius: "50%", background: GRAD.hero, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, ...slam, boxShadow: "0 16px 36px rgba(63,135,101,0.4)" }}>
      <svg width={42} height={42} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
    </div>
  );
};

const Chip: React.FC<{ label: string; value: number; logo: string; delay: number }> = ({ label, value, logo, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: SPRING.SMOOTH });
  const v = useCountUp(value, delay + 2, 18);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 20px 12px 12px", borderRadius: 999, background: GLASS.bgStrong, border: `1px solid ${GLASS.stroke}`, boxShadow: GLASS.shadow, opacity: p, transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)` }}>
      <Img src={staticFile(`brand/stocks/${logo}.png`)} style={{ width: 40, height: 40, borderRadius: 12 }} />
      <span style={{ fontFamily: hanken, fontWeight: 600, fontSize: 30, color: COLOR.ink }}>{label}</span>
      <span style={{ fontFamily: fraunces, fontWeight: 600, fontSize: 34, color: COLOR.primaryD }}>{frame >= delay ? Math.round(v) : 0}%</span>
    </div>
  );
};
