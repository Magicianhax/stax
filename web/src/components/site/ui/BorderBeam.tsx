"use client";

// A single sage beam travelling the parent's border. Absolute overlay: the
// parent must be `position: relative; overflow: hidden` and carry the radius.
// A 1px ring mask carries a rotating conic gradient, so the beam follows the
// rounded corners exactly. Hidden under reduced motion (a frozen highlight
// would read as a rendering error).
import { useRef } from "react";
import { gsap, useGSAP, MOTION_OK } from "./gsap";
import s from "./BorderBeam.module.css";

export function BorderBeam({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const o = { a: 0 };
        gsap.set(el, { opacity: 0 });
        gsap.to(el, { opacity: 1, duration: 0.8, delay: 0.4 });
        gsap.to(o, {
          a: 360,
          duration: 7,
          ease: "none",
          repeat: -1,
          onUpdate: () => el.style.setProperty("--beam", `${o.a}deg`),
        });
      });
    },
    { scope: ref },
  );

  return <span ref={ref} aria-hidden="true" className={className ? `${s.beam} ${className}` : s.beam} />;
}
