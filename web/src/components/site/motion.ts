"use client";

// Motion primitives for the marketing site (route "/").
//
//   useReveal()               → { ref, className }  adds `is-in` once the element
//                               enters the viewport (IntersectionObserver, once,
//                               threshold 0.2). The CSS lives in globals.css
//                               (`.site[data-ready] .reveal`) so every section
//                               shares one entrance; transforms/opacity only.
//   useCountUp(target, opts)  → number that counts 0 → target once (rAF, expo
//                               ease-out). Snaps to `target` under reduced motion.
//   usePrefersReducedMotion() → boolean, live via matchMedia.
//   useMediaQuery(query)      → boolean, live via matchMedia (false on the server).
//   <Reveal delay as className> → a wrapper that applies useReveal for you.
//
// Nothing here animates a layout property, and nothing here ever hides content
// when JS is missing: the reveal classes only take effect once the shell sets
// `data-ready` on `.site`.
import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ElementType, type ReactNode } from "react";

const REVEAL_THRESHOLD = 0.2;

export function useReveal(): { ref: (el: Element | null) => void; className: string } {
  const [inView, setInView] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((el: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: REVEAL_THRESHOLD, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    observer.current = io;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, className: inView ? "reveal is-in" : "reveal" };
}

function subscribeMedia(query: string, onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(query);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Live media-query match; `false` during SSR and the first client render. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => subscribeMedia(query, cb), [query]);
  const get = useCallback(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false), [query]);
  return useSyncExternalStore(subscribe, get, () => false);
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Count from 0 to `target` once `start` is true. Runs one time; later changes
 * to `target` (a refetch) snap without re-animating. Reduced motion snaps.
 */
export function useCountUp(target: number, { duration = 1400, start = true }: { duration?: number; start?: boolean } = {}): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (!start) return;
    if (done.current || reduced || !Number.isFinite(target) || target <= 0) {
      setValue(Number.isFinite(target) ? target : 0);
      if (target > 0) done.current = true;
      return;
    }
    done.current = true;
    let raf = 0;
    let t0: number | null = null;
    const step = (ts: number) => {
      if (t0 === null) t0 = ts;
      const p = Math.min((ts - t0) / duration, 1);
      setValue(target * expoOut(p));
      if (p < 1) raf = requestAnimationFrame(step);
      else setValue(target);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, start, duration, reduced]);

  return value;
}

export interface RevealProps {
  /** Stagger delay in ms (applied as `--reveal-delay`). */
  delay?: number;
  as?: ElementType;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
}

/** `<Reveal delay={60} as="li" className="…">` — useReveal as a wrapper. */
export function Reveal({ delay = 0, as = "div", className = "", id, style, children }: RevealProps) {
  const { ref, className: rv } = useReveal();
  return createElement(
    as,
    {
      ref,
      id,
      className: `${rv}${className ? ` ${className}` : ""}`,
      style: delay ? { ...style, "--reveal-delay": `${delay}ms` } : style,
    },
    children,
  );
}
