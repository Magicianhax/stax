// One place to register GSAP plugins for the marketing site. Every animation
// on `/` imports { gsap, ScrollTrigger, useGSAP } from here so registration
// happens exactly once, and shares the two media conditions below.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Trigger positions are computed at mount, before fonts and the phone screenshots
// have laid out. Refresh once everything has loaded (and once more shortly after)
// so scrubbed/once triggers never sit on stale offsets.
if (typeof window !== "undefined") {
  ScrollTrigger.config({ ignoreMobileResize: true });
  const refresh = () => ScrollTrigger.refresh();
  window.addEventListener("load", refresh, { once: true });
  document.fonts?.ready.then(refresh).catch(() => {});
  window.setTimeout(refresh, 1500);
}

/** Motion is allowed. Every tween lives inside a matchMedia block on this. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
/** Pointer hover work (tilt, glow, shine) is enabled only on hover devices. */
export const HOVER_OK = "(hover: hover) and (prefers-reduced-motion: no-preference)";

export { gsap, ScrollTrigger, useGSAP };
