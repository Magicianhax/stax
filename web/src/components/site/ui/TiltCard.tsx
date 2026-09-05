"use client";

// Tilts its content up to `max` degrees toward the pointer (hover devices
// only, motion allowed only) and springs back on leave. The wrapper provides
// the perspective; the inner element receives the rotation so children keep
// their own hover transforms.
import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, HOVER_OK } from "./gsap";
import s from "./TiltCard.module.css";

export function TiltCard({
  children,
  className,
  max = 3,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const root = ref.current;
      const inner = root?.firstElementChild as HTMLElement | null;
      if (!root || !inner || !contextSafe) return;

      const mm = gsap.matchMedia();
      mm.add(HOVER_OK, () => {
        const rx = gsap.quickTo(inner, "rotationX", { duration: 0.45, ease: "power3" });
        const ry = gsap.quickTo(inner, "rotationY", { duration: 0.45, ease: "power3" });

        const move = contextSafe((e: PointerEvent) => {
          const r = root.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          ry(px * 2 * max);
          rx(-py * 2 * max);
        });
        const leave = contextSafe(() => {
          gsap.to(inner, { rotationX: 0, rotationY: 0, duration: 0.7, ease: "back.out(1.4)", overwrite: "auto" });
        });

        root.addEventListener("pointermove", move);
        root.addEventListener("pointerleave", leave);
        return () => {
          root.removeEventListener("pointermove", move);
          root.removeEventListener("pointerleave", leave);
        };
      });
    },
    { scope: ref, dependencies: [max] },
  );

  return (
    <div ref={ref} className={className ? `${s.root} ${className}` : s.root}>
      <div className={s.inner}>{children}</div>
    </div>
  );
}
