"use client";

// Scroll reveal: the direct children of <Reveal> rise (y 24 → 0, opacity 0 → 1)
// once, staggered, when the wrapper enters the viewport.
//
// Robustness rules (this replaced a ScrollTrigger version that left basket cards
// and FAQ rows invisible when trigger positions went stale after images loaded):
//  - content renders visible; JS hides it only when the wrapper starts below the fold
//  - the trigger is an IntersectionObserver on the wrapper itself, plus a scroll
//    safety check and a 4s timer, so a section can never stay hidden
//  - reduced motion: nothing is ever hidden
import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import { gsap } from "./gsap";

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * Run `cb` once when `el` first enters the viewport (or immediately if it already
 * is). Returns a disposer. Used by Reveal and by sections with their own entrance
 * tween (basket weight bars), so every entrance shares one trigger strategy.
 */
export function onEnter(el: Element, cb: () => void, offset = 0.9): () => void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    cleanup();
    cb();
  };
  const inView = () => el.getBoundingClientRect().top < window.innerHeight * offset;
  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && fire(), {
          rootMargin: `0px 0px -${Math.round((1 - offset) * 100)}% 0px`,
          threshold: 0.01,
        })
      : null;
  const onScroll = () => inView() && fire();
  const timer = window.setTimeout(() => inView() && fire(), 4000);
  const cleanup = () => {
    io?.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.clearTimeout(timer);
  };
  if (inView()) {
    fire();
    return cleanup;
  }
  io?.observe(el);
  window.addEventListener("scroll", onScroll, { passive: true });
  return cleanup;
}

export function Reveal({
  children,
  stagger = 0.06,
  className,
  as = "div",
}: {
  children: ReactNode;
  stagger?: number;
  className?: string;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia(REDUCED).matches) return;
    const items = Array.from(el.children) as HTMLElement[];
    if (!items.length) return;

    const ctx = gsap.context(() => {
      // Already on screen: a light entrance, no hidden frame.
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
        gsap.from(items, { y: 16, opacity: 0, duration: 0.7, ease: "expo.out", stagger, clearProps: "transform,opacity" });
        return;
      }
      gsap.set(items, { y: 24, opacity: 0 });
    }, el);

    const dispose = onEnter(el, () => {
      ctx.add(() => {
        gsap.to(items, { y: 0, opacity: 1, duration: 0.9, ease: "expo.out", stagger, overwrite: true, clearProps: "transform,opacity" });
      });
    });

    return () => {
      dispose();
      ctx.revert();
    };
  }, [stagger]);

  const Tag = as;
  return (
    <Tag ref={ref} className={className} data-reveal="">
      {children}
    </Tag>
  );
}
