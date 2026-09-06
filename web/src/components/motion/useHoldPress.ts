"use client";

// useHoldPress — press-and-hold to confirm. Pointer or keyboard (Space/Enter
// held). Releasing before `ms` snaps the ring back; completing fires
// haptic.success() + onComplete once.
//
//   const { bind, progress, holding } = useHoldPress({ ms: 900, onComplete });
//   <button {...bind}>…ring driven by progress (0..1)…</button>
//
// Options: ms (default 900), onComplete, disabled.
// Returns: bind (spread onto the element), progress 0..1 (rAF-driven), holding.
// `HoldButton` (same folder) wraps this in a .btn.btn-primary with the ring.
import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

export interface UseHoldPressOptions {
  ms?: number;
  onComplete: () => void;
  disabled?: boolean;
}

export interface HoldPressBind {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onKeyUp: (e: React.KeyboardEvent) => void;
  onBlur: () => void;
  onContextMenu: (e: React.SyntheticEvent) => void;
}

export interface UseHoldPressResult {
  bind: HoldPressBind;
  progress: number;
  holding: boolean;
}

export function useHoldPress({ ms = 900, onComplete, disabled = false }: UseHoldPressOptions): UseHoldPressResult {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const raf = useRef(0);
  const start = useRef(0);
  const active = useRef(false);
  const done = useRef(false);
  const complete = useRef(onComplete);
  useEffect(() => {
    complete.current = onComplete;
  }, [onComplete]);

  const stopFrames = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  };

  const snapBack = useCallback((from: number) => {
    // Soft snap-back: ease the ring down over 200 ms rather than blinking to 0.
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 200, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setProgress(from * (1 - e));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  const begin = useCallback(() => {
    if (disabled || active.current) return;
    active.current = true;
    done.current = false;
    stopFrames();
    start.current = performance.now();
    setHolding(true);
    const tick = (now: number) => {
      if (!active.current) return;
      const p = Math.min((now - start.current) / ms, 1);
      setProgress(p);
      if (p < 1) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      active.current = false;
      done.current = true;
      setHolding(false);
      haptic.success();
      complete.current();
      // Leave the ring full briefly so the completion reads, then reset.
      raf.current = 0;
      window.setTimeout(() => setProgress(0), 400);
    };
    raf.current = requestAnimationFrame(tick);
  }, [disabled, ms]);

  const cancel = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    setHolding(false);
    stopFrames();
    const elapsed = Math.min((performance.now() - start.current) / ms, 1);
    snapBack(elapsed);
  }, [ms, snapBack]);

  useEffect(() => () => stopFrames(), []);

  const bind: HoldPressBind = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault(); // no text selection / focus flicker while holding
      begin();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onKeyDown: (e) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        begin();
      }
    },
    onKeyUp: (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        cancel();
      }
    },
    onBlur: cancel,
    onContextMenu: (e) => e.preventDefault(),
  };

  return { bind, progress, holding };
}
