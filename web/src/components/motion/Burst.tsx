"use client";

// Burst — one-shot brand confetti (primary, accent, paper), 900 ms.
// Absolutely positioned over its nearest positioned ancestor; pointer-events none.
//
//   <Burst fire={done} />          fires once each time `fire` goes false → true
//
// Props: fire (default true, so a bare <Burst /> fires on mount), count (26).
// Reduced motion → renders nothing. `Confetti` in components/design re-exports it.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { reducedMotion } from "./reduced";
import s from "./motion.module.css";

export interface BurstProps {
  fire?: boolean;
  count?: number;
}

const COLORS = ["var(--primary)", "var(--accent)", "var(--paper)"];

// Deterministic per-piece geometry from a seed so a render never reshuffles.
function pieces(count: number, seed: number) {
  const rand = (n: number) => {
    const x = Math.sin(seed * 7919 + n * 104729) * 10000;
    return x - Math.floor(x);
  };
  return Array.from({ length: count }, (_, i) => {
    const ang = (Math.PI * 2 * i) / count + rand(i);
    const dist = 70 + rand(i + 1) * 90;
    return {
      tx: Math.cos(ang) * dist,
      ty: Math.sin(ang) * dist - 30,
      r: rand(i + 2) * 360,
      d: rand(i + 3) * 0.15,
      c: COLORS[i % COLORS.length],
      sz: 6 + rand(i + 4) * 6,
      round: rand(i + 5) > 0.5,
    };
  });
}

export function Burst({ fire = true, count = 26 }: BurstProps) {
  // `shot` counts rising edges of `fire`; `expired` is the last shot that ended.
  const [prevFire, setPrevFire] = useState(false);
  const [shot, setShot] = useState(0);
  const [expired, setExpired] = useState(0);
  if (fire !== prevFire) {
    setPrevFire(fire);
    if (fire) setShot((n) => n + 1);
  }

  useEffect(() => {
    if (shot === 0) return;
    const t = setTimeout(() => setExpired(shot), 900 + 150);
    return () => clearTimeout(t);
  }, [shot]);

  const parts = useMemo(() => pieces(count, shot), [count, shot]);
  if (shot === 0 || expired === shot || reducedMotion()) return null;

  return (
    <div
      aria-hidden
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }}
    >
      {parts.map((p, i) => (
        <span
          key={`${shot}-${i}`}
          className={s.burstPiece}
          style={
            {
              width: p.sz,
              height: p.sz,
              background: p.c,
              borderRadius: p.round ? "50%" : 2,
              animationDelay: `${p.d}s`,
              "--tx": `${p.tx}px`,
              "--ty": `${p.ty}px`,
              "--r": `${p.r}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
