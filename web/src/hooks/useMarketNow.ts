"use client";

// The instant "is the US market open" is answered at. The real clock everywhere, except inside the
// BNB Chain demo, where the visitor can pin the market open or closed (components/demo/
// DemoProvider.tsx), so Home's line, Market's header and Vera's plan note agree with the demo
// catalog instead of with the wall clock.
import { useCallback } from "react";
import { useDemo } from "@/components/demo/DemoProvider";

export function useMarketNow(): () => number {
  const demo = useDemo();
  const pinned = demo?.rwa ? demo.nowMs : null;
  return useCallback(() => (pinned !== null ? pinned : Date.now()), [pinned]);
}
