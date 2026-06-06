"use client";

// LoopVideo — a seamless, "endless" autoplay loop. A plain <video loop> hard-cuts
// from the last frame back to the first; here two stacked copies crossfade into
// each other at the seam, so the restart is invisible. Muted + playsInline so the
// browser allows autoplay.
import { useEffect, useRef } from "react";

export function LoopVideo({
  src,
  poster,
  className,
  fade = 0.7,
}: {
  src: string;
  poster?: string;
  className?: string;
  /** crossfade length in seconds */
  fade?: number;
}) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    let active = a;
    let idle = b;
    active.style.opacity = "1";
    idle.style.opacity = "0";
    active.play().catch(() => {});

    // When the active copy is within `fade` of its end, start the idle copy from 0
    // and crossfade to it, then swap roles — an endless dissolve, never a cut.
    const tick = () => {
      const v = active;
      const d = v.duration;
      if (Number.isFinite(d) && d > 0 && idle.paused && d - v.currentTime <= fade) {
        idle.currentTime = 0;
        idle.style.opacity = "1";
        v.style.opacity = "0";
        idle.play().catch(() => {});
        const tmp = active;
        active = idle;
        idle = tmp;
      }
    };

    a.addEventListener("timeupdate", tick);
    b.addEventListener("timeupdate", tick);
    return () => {
      a.removeEventListener("timeupdate", tick);
      b.removeEventListener("timeupdate", tick);
      a.pause();
      b.pause();
    };
  }, [fade]);

  const common = { muted: true, playsInline: true, preload: "auto" as const, poster, className };
  const style = { transition: `opacity ${fade}s linear` };
  return (
    <>
      <video ref={aRef} {...common} style={style}>
        <source src={src} type="video/mp4" />
      </video>
      <video ref={bRef} {...common} style={style}>
        <source src={src} type="video/mp4" />
      </video>
    </>
  );
}
