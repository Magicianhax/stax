"use client";

// Receipt — the on-chain record in plain words. Two callers:
//   • a manual trade just filled (`order` + `txHash` + `at`, routed by LiteApp
//     from Placing): hero is the asset's tile with a drawn check, the rows are
//     side-specific, and Close hands back to LiteApp (asset detail + toast).
//   • history (Home / Activity / Vera): `title` / `amount` / `txHash` / `ref`,
//     no order — Close simply goes back.
// For real trades we link to the chain's explorer; Vera's sample recorded
// recommendations only carry an illustrative reference.
import { AssetTile, Icon, Seal, useToast } from "@/components/design";
import { DrawCheck, Money, Reveal } from "@/components/motion";
import { toTile } from "@/lib/displayAssets";
import { usd, txUrl } from "@/lib/format";
import { useChain } from "@/lib/chains/active";
import { haptic } from "@/lib/haptics";
import { iconBtn } from "./primitives";
import type { TradeOrder } from "../LiteApp";

/** "Sep 7, 2026 · 14:02" */
function exactTime(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${time}`;
}

export function ReceiptScreen({
  go,
  title,
  amount,
  txHash,
  ref,
  date,
  order,
  at,
  onClose,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  title?: string;
  amount?: number;
  txHash?: string;
  ref?: string;
  date?: string;
  /** The trade that just filled (manual buy/sell). */
  order?: TradeOrder;
  /** When it filled (ms epoch) — shown as an exact time. */
  at?: number;
  /** Closing-the-loop handler from LiteApp; falls back to go(-1). */
  onClose?: () => void;
}) {
  const chain = useChain();
  const { notify } = useToast();
  const explorerHref = txHash ? txUrl(txHash, chain) : undefined;
  const isSell = order?.side === "sell";
  const heading = order ? `${isSell ? "Sold" : "Bought"} ${order.name}` : (title ?? "Invested with Vera");
  const shownAmount = order ? order.amountUsd : amount;
  const when = at ? exactTime(at) : (date ?? "Today, just now");
  const close = onClose ?? (() => go(-1));

  const share = async () => {
    haptic.light();
    const url = explorerHref ?? window.location.href;
    const text = `${heading}${shownAmount !== undefined ? ` · ${usd(shownAmount)}` : ""} on Stax`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: heading, text, url });
        return;
      } catch {
        // cancelled or unsupported → fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copied");
    } catch {
      notify("Couldn't copy the link", "info");
    }
  };

  const status = (
    <span key="s" style={{ color: "var(--pos)" }}>
      Completed
    </span>
  );
  const rows: [string, React.ReactNode][] = order
    ? isSell
      ? [
          ["Shares & price", `${order.qty} ${order.ticker} @ ${usd(order.priceUsd)}`],
          ["Added to cash", usd(order.amountUsd)],
          ["Status", status],
          ["Network", chain.name],
          ["Time", when],
        ]
      : [
          ["Shares & price", `${order.qty} ${order.ticker} @ ${usd(order.priceUsd)}`],
          ["Fee", usd(order.feeUsd)],
          ["Status", status],
          ["Paid from", "Your cash balance"],
          ["Ownership", "Real shares, held by you"],
          ["Network", chain.name],
          ["Time", when],
        ]
    : [
        ["Status", status],
        ["Network cost", "Free"],
        ["Paid from", "Your cash balance"],
        ["Network", chain.name],
        ["Time", when],
      ];

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={close} style={iconBtn} className="tap" aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, marginLeft: 4, fontSize: 24, letterSpacing: "-.01em" }}>
          Receipt
        </h1>
      </div>

      {/* hero: the asset with its check, then the amount counting in once */}
      <Reveal style={{ padding: "18px 22px 0", textAlign: "center" }}>
        <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 14px" }}>
          {order ? (
            <>
              <AssetTile asset={toTile(order.symbol, order.name)} size={64} />
              {/* .receipt-hero (globals.css, feel-brand) paints the ring: soft on dark,
                  surface + line stroke on light so the badge never sinks into the paper */}
              <span
                className="receipt-hero"
                style={{
                  position: "absolute",
                  right: -8,
                  bottom: -6,
                  padding: 2,
                  borderRadius: "50%",
                  display: "grid",
                }}
              >
                <DrawCheck size={26} delay={0.25} />
              </span>
            </>
          ) : (
            <DrawCheck size={64} delay={0.1} />
          )}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.02em" }}>{heading}</div>
        {shownAmount !== undefined && (
          <div style={{ marginTop: 4 }}>
            <Money value={Math.abs(shownAmount)} prev={0} size={34} style={{ fontWeight: 700, letterSpacing: "-.02em" }} />
          </div>
        )}
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
          {order ? (isSell ? "Paid into your cash balance" : "Held in your account") : when}
        </div>
      </Reveal>

      {/* details */}
      <div style={{ padding: "22px 22px 0" }}>
        <Reveal delay={0.15} className="card" style={{ padding: "4px 18px" }}>
          {rows.map(([k, v], i) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 0",
                borderTop: i ? "1px solid var(--line-2)" : "none",
                fontSize: 14.5,
              }}
            >
              <span style={{ color: "var(--ink-2)", flex: "none" }}>{k}</span>
              <span className="tnum" style={{ fontWeight: 600, textAlign: "right" }}>
                {v}
              </span>
            </div>
          ))}
        </Reveal>
      </div>

      {/* next actions */}
      {order && (
        <Reveal delay={0.3} style={{ display: "flex", gap: 8, padding: "14px 22px 0" }}>
          {(
            [
              ["Buy more", "plus", () => go("trade", { symbol: order.symbol, side: "buy" })],
              ["View position", "trend", close],
              ["Share", "send", share],
            ] as const
          ).map(([label, icon, fn]) => (
            <button
              key={label}
              type="button"
              className="btn btn-glass tap"
              onClick={fn}
              style={{
                flex: 1,
                height: 56,
                flexDirection: "column",
                gap: 4,
                fontSize: 12.5,
                fontWeight: 600,
                padding: 0,
              }}
            >
              <Icon name={icon} size={18} />
              {label}
            </button>
          ))}
        </Reveal>
      )}

      {/* on-chain record (plain words) */}
      <Reveal delay={0.4} style={{ padding: "14px 22px 0" }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Seal size={24} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: "-.01em" }}>Permanent record</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Signed &amp; recorded on {chain.name}</div>
            </div>
          </div>
          <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "12px 0 14px", lineHeight: 1.55 }}>
            This can&apos;t be edited or deleted, and anyone can check it. It&apos;s how Vera&apos;s track record stays
            honest.
          </p>
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-glass btn-block tap"
              style={{ height: 46, fontSize: 14.5, textDecoration: "none" }}
            >
              View on {chain.explorer.name} <Icon name="arrowUR" size={16} />
            </a>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", textAlign: "center" }}>
              {ref ? `Reference ${ref}` : "Recorded on-chain"}
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
}
