"use client";

// Activity & receipts — a user's REAL on-chain Stax history (useActivity),
// newest first, each row opening its Mantlescan receipt. Reached from Settings.
import { useState } from "react";
import { useActivity } from "@/hooks/useActivity";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { Icon, VerifiedBadge } from "@/components/design";
import { shortAddress, usd } from "@/lib/format";
import { iconBtn, Pager } from "./primitives";

const PER_PAGE = 10;

export function ActivityScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  const { data: activity, isLoading } = useActivity(address ?? undefined);
  const rows = activity ?? [];

  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>
          Activity
        </h1>
      </div>

      <div style={{ padding: "18px 22px 0" }}>
        {isLoading && rows.length === 0 ? (
          <div className="card" style={{ padding: "4px 16px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "13px 0",
                  borderBottom: i < 2 ? "1px solid var(--line-2)" : "none",
                }}
              >
                <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 11, flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "50%", height: 13, borderRadius: 6 }} />
                  <div className="skeleton" style={{ width: "32%", height: 11, borderRadius: 6, marginTop: 7 }} />
                </div>
                <div className="skeleton" style={{ width: 52, height: 15, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div
            className="card"
            style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Nothing yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              When you place a plan, its signed on-chain receipt will appear here.
            </div>
          </div>
        ) : (
          <div className="card stagger-in" style={{ padding: "4px 16px" }}>
            {pageRows.map((a, i) => (
              <button
                key={`${a.txHash}-${safePage}-${i}`}
                className="row"
                onClick={() =>
                  go("receipt", { title: "Invested in a plan", amount: a.usdc, txHash: a.txHash })
                }
                style={{
                  padding: "13px 0",
                  borderBottom: i < pageRows.length - 1 ? "1px solid var(--line-2)" : "none",
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    background: "var(--primary-soft)",
                    color: "var(--primary)",
                  }}
                >
                  <Icon name="check" size={18} stroke={2.2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>Invested in a plan</div>
                  <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                    {a.legCount} {a.legCount === 1 ? "holding" : "holdings"} · {shortAddress(a.txHash)}
                  </div>
                </div>
                <span className="tnum" style={{ fontWeight: 700, fontSize: 15 }}>
                  {usd(a.usdc)}
                </span>
              </button>
            ))}
          </div>
        )}
        {rows.length > PER_PAGE && <Pager page={safePage} pageCount={pageCount} onPage={setPage} />}
      </div>

      <div style={{ padding: "18px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("vera")} />
      </div>
    </div>
  );
}
