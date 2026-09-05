"use client";

// One-line marquee. Children are duplicated (aria-hidden) so the track can
// loop seamlessly; `speed` is px per second. Pauses on hover and on keyboard
// focus inside; static under reduced motion.
import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, MOTION_OK } from "./gsap";
import s from "./Marquee.module.css";

export function Marquee({
  children,
  speed = 40,
  className,
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const root = ref.current;
      const track = root?.querySelector<HTMLElement>("[data-track]");
      const group = root?.querySelector<HTMLElement>("[data-group]");
      if (!root || !track || !group || !contextSafe) return;

      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        let tween: gsap.core.Tween | null = null;
        // Plain function: called synchronously here (inside the matchMedia
        // context) and later, wrapped, from the ResizeObserver. Wrapping the
        // synchronous call in contextSafe would link the two contexts into a
        // cycle (GSAP Context.add pushes the caller into the active context).
        const build = () => {
          tween?.kill();
          const w = group.getBoundingClientRect().width;
          if (w <= 0) return;
          gsap.set(track, { x: 0 });
          tween = gsap.to(track, { x: -w, duration: w / speed, ease: "none", repeat: -1 });
          if (root.matches(":hover")) tween.pause();
        };
        build();

        const pause = () => tween?.pause();
        const play = () => tween?.play();
        root.addEventListener("pointerenter", pause);
        root.addEventListener("pointerleave", play);
        root.addEventListener("focusin", pause);
        root.addEventListener("focusout", play);
        const ro = new ResizeObserver(contextSafe(build));
        ro.observe(group);
        return () => {
          ro.disconnect();
          tween?.kill();
          root.removeEventListener("pointerenter", pause);
          root.removeEventListener("pointerleave", play);
          root.removeEventListener("focusin", pause);
          root.removeEventListener("focusout", play);
        };
      });
    },
    { scope: ref, dependencies: [speed] },
  );

  return (
    <div ref={ref} className={className ? `${s.root} ${className}` : s.root}>
      <div className={s.track} data-track>
        <div className={s.group} data-group>
          {children}
        </div>
        <div className={s.group} aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
