"use client";

// useFlashRow — a one-time --primary-soft wash (1.2 s) when the element enters
// view. Keyed: each distinct key fires once per session, so a row flashes after
// the trade that touched it and never again on later visits.
//
//   const { ref, className } = useFlashRow(flashKey);   // e.g. `${symbol}:${txHash}`
//   <button ref={ref} className={className}>…</button>
//
// Pass undefined to disable. HoldingRow wires this through its `flashKey` prop.
import { useEffect, useRef, useState } from "react";
import s from "./motion.module.css";

const fired = new Set<string>();

export function useFlashRow<T extends HTMLElement = HTMLElement>(key: string | undefined): {
  ref: React.RefObject<T | null>;
  className: string;
} {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!key || !el || fired.has(key)) return;
    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (fired.has(key)) return;
        fired.add(key);
        setOn(true);
        timer = window.setTimeout(() => setOn(false), 1200);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [key]);

  return { ref, className: on ? s.flashRow : "" };
}
