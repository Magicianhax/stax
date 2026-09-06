"use client";

// ReviewSheet — the order review that sits between Trade and Placing. One look
// at what is about to happen (shares, price, fee, total, network), then a
// hold-to-confirm. Completion hands control back to Trade via onConfirm, which
// fires the real swap and pushes Placing.
import { AssetTile, BottomSheet, type TileAsset } from "@/components/design";
import { HoldButton } from "@/components/motion";
import { useChain } from "@/lib/chains/active";
import { usd } from "@/lib/format";
import type { TradeOrder } from "../LiteApp";

export interface ReviewSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  order: TradeOrder | null;
  tile: TileAsset;
}

export function ReviewSheet({ open, onClose, onConfirm, order, tile }: ReviewSheetProps) {
  const chain = useChain();
  const isSell = order?.side === "sell";
  const title = order ? `${isSell ? "Sell" : "Buy"} ${order.name}` : "Review";
  const qtyLabel = order?.unit === "shares" ? "Shares" : "Amount";

  const rows: [string, string][] = order
    ? isSell
      ? [
          [qtyLabel, `${order.qty} ${order.ticker}`],
          ["Price", usd(order.priceUsd)],
          ["You receive", usd(order.amountUsd)],
          ["Network", chain.name],
        ]
      : [
          [qtyLabel, `≈ ${order.qty} ${order.ticker}`],
          ["Price", usd(order.priceUsd)],
          ["Fee", usd(order.feeUsd)],
          ["Total", usd(order.amountUsd)],
          ["Network", chain.name],
        ]
    : [];

  return (
    <BottomSheet open={open} onClose={onClose} label={title}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "2px 0 16px" }}>
        <AssetTile asset={tile} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="serif" style={{ fontSize: 22, letterSpacing: "-.01em", lineHeight: 1.15 }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
            {isSell ? "Paid into your cash balance" : "Real shares, held by you"}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: "4px 16px" }}>
        {rows.map(([k, v], i) => (
          <div
            key={k}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              padding: "12px 0",
              borderTop: i ? "1px solid var(--line-2)" : "none",
              fontSize: 14.5,
            }}
          >
            <span style={{ color: "var(--ink-2)" }}>{k}</span>
            <span className="tnum" style={{ fontWeight: k === "Total" || k === "You receive" ? 700 : 600 }}>
              {v}
            </span>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", margin: "14px 0 10px", fontSize: 12.5, color: "var(--ink-3)" }}>
        {isSell ? "No fee · no network cost" : "Fee included · no network cost"}
      </div>
      <HoldButton onComplete={onConfirm} ms={900} className="btn-lg" disabled={!order}>
        {isSell ? "Hold to sell" : "Hold to buy"}
      </HoldButton>
    </BottomSheet>
  );
}
