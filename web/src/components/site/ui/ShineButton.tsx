"use client";

// Pill button with a soft shine that sweeps once per hover. Primary is the
// solid sage gradient; glass is the translucent secondary. Scale 1.02 on
// hover (CSS); the sweep is a GSAP tween created in a context-safe handler,
// hover devices only. Renders a Link when given `href`, otherwise a <button>
// (same look, for actions like opening the login modal).
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, HOVER_OK } from "./gsap";
import s from "./ShineButton.module.css";

export function ShineButton({
  href,
  onClick,
  disabled,
  children,
  variant = "primary",
  className,
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  variant?: "primary" | "glass";
  className?: string;
}) {
  const ref = useRef<HTMLAnchorElement & HTMLButtonElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const el = ref.current;
      const shine = el?.querySelector<HTMLElement>("[data-shine]");
      if (!el || !shine || !contextSafe) return;
      const mm = gsap.matchMedia();
      mm.add(HOVER_OK, () => {
        const sweep = contextSafe(() => {
          gsap.fromTo(shine, { xPercent: -160 }, { xPercent: 160, duration: 0.7, ease: "power2.inOut", overwrite: true });
        });
        el.addEventListener("pointerenter", sweep);
        return () => el.removeEventListener("pointerenter", sweep);
      });
    },
    { scope: ref },
  );

  const cls = [s.btn, variant === "glass" ? s.glass : s.primary, className].filter(Boolean).join(" ");
  const inner = (
    <>
      <span className={s.shine} data-shine aria-hidden="true" />
      <span className={s.label}>{children}</span>
    </>
  );
  if (href) {
    return (
      <Link ref={ref} href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button ref={ref} type="button" className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}
