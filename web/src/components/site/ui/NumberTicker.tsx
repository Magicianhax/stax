"use client";

// A number that counts up from 0 to `value` once, when it scrolls into view.
// `null` renders a thin dash (loading / unavailable). Later value changes snap.
// The DOM text is written directly by GSAP so React never re-renders per frame.
import { useRef } from "react";
import { gsap, useGSAP, MOTION_OK } from "./gsap";
import s from "./NumberTicker.module.css";

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-US");

export function NumberTicker({
  value,
  format = defaultFormat,
  className,
}: {
  value: number | null;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const played = useRef(false);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || value === null) return;
      if (played.current || value <= 0) {
        el.textContent = format(value);
        played.current = true;
        return;
      }
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const o = { n: 0 };
        el.textContent = format(0);
        gsap.to(o, {
          n: value,
          duration: 1.4,
          ease: "expo.out",
          onUpdate: () => {
            el.textContent = format(o.n);
          },
          onComplete: () => {
            played.current = true;
            el.textContent = format(value);
          },
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
        });
      });
    },
    { dependencies: [value, format], scope: ref },
  );

  const cls = className ? `${s.n} ${className}` : s.n;
  return (
    <span ref={ref} className={cls} aria-live="off">
      {value === null ? <span className={s.dash}>—</span> : format(value)}
    </span>
  );
}
