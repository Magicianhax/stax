"use client";

// Tactile feedback for the moments that matter. `navigator.vibrate` is the only
// broadly available web haptics primitive (Android Chrome / supporting PWAs);
// iOS Safari doesn't implement it, so every call no-ops gracefully there.
// Gated on a user preference (Settings -> Haptics) and kept deliberately sparse —
// short buzzes on key moments only, never on every tap (haptic fatigue is real).
import { useSyncExternalStore } from "react";

const KEY = "stax:haptics";

export function hapticsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function enabled(): boolean {
  if (!hapticsSupported()) return false;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function fire(pattern: number | number[]) {
  if (!enabled()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // vibrate can throw if the gesture context disallows it; ignore.
  }
}

// Named intents. Keep durations short — long buzzes feel cheap.
export const haptic = {
  select: () => fire(6), // tab change, chip, toggle
  light: () => fire(10), // copy, light confirm
  medium: () => fire(16), // committing money (buy / invest)
  success: () => fire([14, 38, 26]), // investment placed
  warning: () => fire([20, 60, 20]),
};

export function setHaptics(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage unavailable; preference is in-memory for this session only
  }
}

// Hook for the Settings toggle. The preference lives in localStorage and is
// read through useSyncExternalStore so the first client render already matches
// it (the server snapshot is the default "on"); the toggle notifies listeners.
const EVENT = "stax:haptics-change";
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}
function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}
export function useHaptics() {
  const on = useSyncExternalStore(subscribe, readOn, () => true);
  const supported = useSyncExternalStore(subscribe, hapticsSupported, () => false);
  const toggle = () => {
    const next = !on;
    setHaptics(next);
    window.dispatchEvent(new Event(EVENT));
    if (next) haptic.select(); // confirm the new "on" state with a tick
  };
  return { on, supported, toggle };
}
