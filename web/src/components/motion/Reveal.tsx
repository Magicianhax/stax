"use client";

// Reveal — children rise 10 px + fade in on mount, staggered 40 ms, --ease-out,
// 0.42 s. Replaces raw `anim-rise` + animationDelay maths.
//
//   <Reveal as="div" delay={0.1} stagger={0.04} once="home-list">…</Reveal>
//
// Props
//   as       element tag for the wrapper (default "div")
//   delay    seconds before the first child starts (default 0)
//   stagger  seconds between children (default 0.04)
//   once     session key: when set, the reveal plays only the first time this
//            key mounts (so a tab root doesn't replay on every tab return).
//            Remount with a different React `key` (or `once`) to replay.
//   className / style pass through to the wrapper.
// Reduced motion → opacity only, no rise.
import { useRef, type CSSProperties, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { reducedMotion } from "./reduced";

gsap.registerPlugin(useGSAP);

const played = new Set<string>();

export interface RevealProps {
  as?: keyof React.JSX.IntrinsicElements;
  delay?: number;
  stagger?: number;
  once?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Reveal({
  as = "div",
  delay = 0,
  stagger = 0.04,
  once,
  className,
  style,
  children,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (once) {
        if (played.has(once)) return;
        played.add(once);
      }
      const targets = Array.from(el.children);
      if (!targets.length) return;
      const reduce = reducedMotion();
      gsap.from(targets, {
        opacity: 0,
        y: reduce ? 0 : 10,
        duration: reduce ? 0.3 : 0.42,
        ease: "power4.out", // = cubic-bezier(.23,1,.32,1), the --ease-out token
        stagger,
        delay,
        clearProps: "opacity,transform",
      });
    },
    { scope: ref },
  );

  // Any intrinsic tag; typed loosely so `ref` fits every element kind.
  const Tag = as as "div";
  return (
    <Tag ref={ref as React.RefObject<HTMLDivElement | null>} className={className} style={style}>
      {children}
    </Tag>
  );
}
