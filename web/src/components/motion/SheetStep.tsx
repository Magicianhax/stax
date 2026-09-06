"use client";

// SheetStep — a step container inside a BottomSheet. Slides 10 px in from the
// right (dir="fwd") or left (dir="back") with a fade, 0.26 s. Remounts (and so
// replays) whenever `step` changes.
//
//   <SheetStep step={step} dir={dir}>{content}</SheetStep>
//
// Props: step (string, used as the React key), dir "fwd" | "back" (default fwd),
// className / style pass through to the div. Reduced motion → fade only.
import type { CSSProperties, ReactNode } from "react";
import s from "./motion.module.css";

export interface SheetStepProps {
  step: string;
  dir?: "fwd" | "back";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function SheetStep({ step, dir = "fwd", className, style, children }: SheetStepProps) {
  return (
    <div
      key={step}
      className={`${s.step}${dir === "back" ? ` ${s.stepBack}` : ""}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {children}
    </div>
  );
}
