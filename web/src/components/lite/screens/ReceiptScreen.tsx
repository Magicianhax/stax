"use client";

// Receipt — Pro on-chain record (screens_pro.jsx · Receipt) framed in plain
// words. For real buys/invests we receive a live txHash and link to Mantlescan;
// for Vera's sample recorded recommendations we show the illustrative reference.
import { Icon, Seal } from "@/components/design";
import { usd, txUrl } from "@/lib/format";
import { iconBtn } from "./primitives";

export function ReceiptScreen({
  go,
  title = "Invested in a plan",
  amount,
  txHash,
  ref,
  date = "Today, just now",
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  title?: string;
  amount?: number;
  txHash?: string;
  ref?: string;
  date?: string;
}) {
  // Live receipts have a real tx; sample records only have an illustrative ref.
  const explorerHref = txHash ? txUrl(txHash) : undefined;
  const showAmount = amount !== undefined;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, marginLeft: 4, fontSize: 24, letterSpacing: "-.01em" }}>
          Receipt
        </h1>
      </div>

      <div className="anim-rise" style={{ padding: "20px 22px 0", textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: "var(--primary-soft)",
            display: "grid",
            placeItems: "center",
            color: "var(--primary)",
            margin: "0 auto 14px",
          }}
        >
          <Icon name="check" size={32} stroke={2.4} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</div>
        {showAmount && (
          <div className="tnum" style={{ fontSize: 32, fontWeight: 700, marginTop: 6 }}>
            {usd(Math.abs(amount as number))}
          </div>
        )}
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>{date}</div>
      </div>

      {/* details */}
      <div style={{ padding: "24px 22px 0" }}>
        <div className="card" style={{ padding: "6px 18px" }}>
          {(
            [
              ["Status", <span key="s" style={{ color: "var(--pos)", fontWeight: 600 }}>Completed</span>],
              ["Network cost", <span key="n" style={{ color: "var(--pos)", fontWeight: 600 }}>Free</span>],
              ["Paid from", "Your Stax balance"],
              ["Ownership", "Real shares, held by you"],
            ] as const
          ).map(([k, v], i, arr) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "13px 0",
                borderBottom: i < arr.length - 1 ? "1px solid var(--line-2)" : "none",
                fontSize: 14.5,
              }}
            >
              <span style={{ color: "var(--ink-2)" }}>{k}</span>
              <span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* on-chain record (plain words) */}
      <div style={{ padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: 18, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 11 }}>
            <Seal size={30} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: "-.01em" }}>Permanent record</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>Signed &amp; recorded on-chain</div>
          <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "12px auto 14px", lineHeight: 1.55, maxWidth: 330 }}>
            This can&apos;t be edited or deleted, and anyone can check it. It&apos;s how Vera&apos;s
            track record stays honest.
          </p>
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-glass btn-block tap"
              style={{ height: 46, fontSize: 14.5, textDecoration: "none" }}
            >
              View on Mantlescan <Icon name="arrowUR" size={16} />
            </a>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", textAlign: "center" }}>
              {ref ? `Reference ${ref}` : "Recorded on-chain"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
