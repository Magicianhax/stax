"use client";

// RefusalNote — Vera's own "no" (market closed, under $6 a stock), as a calm note rather than the
// red error banner. Shared by the goal screen (the first ask) and the plan screen (a nudge that the
// server then refused), so both say it the same way.
import { Icon } from "@/components/design";

export function RefusalNote({ children, marginTop = 20 }: { children: string; marginTop?: number }) {
  return (
    <div
      role="status"
      className="card anim-rise"
      style={{ marginTop, padding: "13px 15px", display: "flex", gap: 11, alignItems: "flex-start" }}
    >
      <Icon name="clock" size={18} style={{ flex: "none", marginTop: 2, color: "var(--ink-2)" }} />
      <div style={{ fontSize: 14.5, lineHeight: 1.5, color: "var(--ink)" }}>{children}</div>
    </div>
  );
}
