"use client";

// The hero ground: a sparse 48px dot lattice at 8% ink, of which about one in
// six breathes (opacity 0.08 → 0.22 over 4–7s, random phase), plus a soft sage
// glow that follows the pointer with a 0.6s lag. The lattice is a CSS
// gradient; only the breathing dots are DOM nodes. Absolute overlay, fades at
// the edges with a mask; the parent must be `position: relative`. Pointer
// tracking listens on the parent. Reduced motion: nothing moves.
import { useRef } from "react";
import { gsap, useGSAP, MOTION_OK, HOVER_OK } from "./gsap";
import s from "./DotField.module.css";

const STEP = 48;
const HALF = STEP / 2;

export function DotField({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const root = ref.current;
      const layer = root?.querySelector<HTMLElement>("[data-dots]");
      const glow = root?.querySelector<HTMLElement>("[data-glow]");
      const host = root?.parentElement;
      if (!root || !layer || !glow || !host || !contextSafe) return;

      const mm = gsap.matchMedia();

      mm.add(MOTION_OK, () => {
        const rand = gsap.utils.random;
        let size = "";
        // Plain function for the synchronous first build (see Marquee for
        // why); the ResizeObserver gets the context-safe wrapper.
        const build = () => {
          const key = `${root.clientWidth}x${root.clientHeight}`;
          if (key === size) return;
          size = key;
          gsap.killTweensOf(layer.children);
          layer.replaceChildren();
          const cols = Math.ceil(root.clientWidth / STEP);
          const rows = Math.ceil(root.clientHeight / STEP);
          const frag = document.createDocumentFragment();
          const picked: HTMLSpanElement[] = [];
          for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
              if (Math.random() > 1 / 6) continue;
              const d = document.createElement("span");
              d.className = s.dot;
              d.style.left = `${i * STEP + HALF}px`;
              d.style.top = `${j * STEP + HALF}px`;
              frag.appendChild(d);
              picked.push(d);
            }
          }
          layer.appendChild(frag);
          picked.forEach((d) => {
            gsap.fromTo(
              d,
              { opacity: 0.08 },
              {
                opacity: 0.22,
                duration: rand(4, 7),
                delay: -rand(0, 7),
                ease: "sine.inOut",
                yoyo: true,
                repeat: -1,
              },
            );
          });
        };
        build();
        const ro = new ResizeObserver(contextSafe(build));
        ro.observe(root);
        return () => {
          ro.disconnect();
          gsap.killTweensOf(layer.children);
          layer.replaceChildren();
        };
      });

      mm.add(HOVER_OK, () => {
        const pos = { x: 0, y: 0 };
        const apply = () => {
          glow.style.setProperty("--gx", `${pos.x}px`);
          glow.style.setProperty("--gy", `${pos.y}px`);
        };
        const toX = gsap.quickTo(pos, "x", { duration: 0.6, ease: "power3", onUpdate: apply });
        const toY = gsap.quickTo(pos, "y", { duration: 0.6, ease: "power3", onUpdate: apply });
        let seeded = false;

        const move = contextSafe((e: PointerEvent) => {
          const r = root.getBoundingClientRect();
          const x = e.clientX - r.left;
          const y = e.clientY - r.top;
          if (!seeded) {
            seeded = true;
            pos.x = x;
            pos.y = y;
            apply();
          }
          toX(x);
          toY(y);
          gsap.to(glow, { opacity: 1, duration: 0.6, overwrite: "auto" });
        });
        const leave = contextSafe(() => {
          gsap.to(glow, { opacity: 0, duration: 0.8, overwrite: "auto" });
        });
        host.addEventListener("pointermove", move);
        host.addEventListener("pointerleave", leave);
        return () => {
          host.removeEventListener("pointermove", move);
          host.removeEventListener("pointerleave", leave);
        };
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} aria-hidden="true" className={className ? `${s.field} ${className}` : s.field}>
      <div className={s.lattice} />
      <div className={s.dots} data-dots />
      <div className={s.glow} data-glow />
    </div>
  );
}
