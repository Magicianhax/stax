"use client";

// Live deposits under the address card. Polled every 6 s by the parent's
// useDepositStatus while the card is open; this only renders what it gets, in
// plain words: "On its way…", "$25.00 arrived · 2 min ago", or what went wrong.
import { Icon } from "@/components/design";
import { usd } from "@/lib/format";
import type { DepositRow } from "@/hooks/useReceive";
import s from "./receive.module.css";

function since(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)} d ago`;
  return new Date(unixSec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function label(d: DepositRow): { text: string; tone: "pending" | "ok" | "bad" } {
  const amt = d.amountUsd !== null && d.amountUsd !== undefined ? usd(d.amountUsd) : undefined;
  switch (d.status) {
    case "pending":
      return { text: amt ? `${amt} on its way…` : "On its way…", tone: "pending" };
    case "success":
      return { text: `${amt ?? "Money"} arrived`, tone: "ok" };
    case "refund":
      return { text: amt ? `${amt} sent back to your refund address` : "Sent back to your refund address", tone: "bad" };
    default:
      return { text: amt ? `${amt} didn't go through` : "Didn't go through", tone: "bad" };
  }
}

export function DepositHistory({ deposits, loading }: { deposits: DepositRow[] | undefined; loading: boolean }) {
  if (!deposits || deposits.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 4px 2px", color: "var(--ink-2)", fontSize: 13 }}>
        {loading ? (
          <span className="skeleton" style={{ width: 160, height: 13, borderRadius: 6 }} />
        ) : (
          <>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ink-3)", flex: "none" }} />
            Watching for a deposit. Leave this open, or come back any time.
          </>
        )}
      </div>
    );
  }
  return (
    <div style={{ padding: "6px 0 0" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", padding: "0 4px 8px" }}>Recent deposits</div>
      <ul style={{ listStyle: "none", margin: 0, padding: "0 4px", display: "flex", flexDirection: "column" }} aria-live="polite">
        {deposits.slice(0, 5).map((d, i) => {
          const { text, tone } = label(d);
          return (
            <li
              key={d.id}
              style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}
            >
              <span aria-hidden style={{ width: 24, height: 24, flex: "none", display: "grid", placeItems: "center" }}>
                {tone === "pending" ? (
                  <span className={s.pendingDot} />
                ) : (
                  <span
                    style={{ width: 22, height: 22, borderRadius: 99, display: "grid", placeItems: "center", background: tone === "ok" ? "var(--primary)" : "var(--surface-2)", color: tone === "ok" ? "var(--primary-ink)" : "var(--ink-2)" }}
                  >
                    <Icon name={tone === "ok" ? "check" : "close"} size={13} stroke={2.6} />
                  </span>
                )}
              </span>
              <span className="tnum" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: tone === "pending" ? "var(--ink-2)" : "var(--ink)" }}>
                {text}
              </span>
              <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)", flex: "none" }}>{since(d.createdAt)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
