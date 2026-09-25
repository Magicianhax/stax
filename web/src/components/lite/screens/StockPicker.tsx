"use client";

// A stock picker for Autopilot rules: a row showing the chosen company (logo + name), which opens
// a sheet listing every stock a rule can name, searchable by company or ticker. Replaces typing a
// ticker by hand, which a first-time investor can't be expected to know.
import { useMemo, useState } from "react";
import { BottomSheet, Icon } from "@/components/design";
import { TokenLogo } from "@/components/lite/TokenLogo";
import type { StockChoice } from "@/lib/autopilotChoices";
import { haptic } from "@/lib/haptics";

export function StockPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly StockChoice[];
  onChange: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const picked = options.find((o) => o.symbol === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.symbol.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div>
      <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{label}</span>
      <button
        type="button"
        className="tap"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        style={{ width: "100%", minHeight: 52, marginTop: 6, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 12, background: "var(--surface-2)", textAlign: "left" }}
      >
        {picked ? <TokenLogo symbol={picked.symbol} size={30} /> : null}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{picked?.name ?? "Choose a stock"}</span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>{picked ? "Change" : "Choose"}</span>
      </button>

      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setQuery("");
        }}
        title="Choose a stock"
      >
        <label className="field" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px", minHeight: 48 }}>
          <Icon name="search" size={17} style={{ color: "var(--ink-2)", flex: "none" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Apple, Tesla…"
            aria-label="Search stocks"
            style={{ flex: 1, minWidth: 0, fontSize: 16, height: 46 }}
          />
        </label>
        <div role="listbox" aria-label={label} style={{ maxHeight: "52vh", overflowY: "auto", margin: "10px -4px 0" }}>
          {shown.map((o) => {
            const on = o.symbol === value;
            return (
              <button
                key={o.symbol}
                type="button"
                role="option"
                aria-selected={on}
                className="row tap"
                onClick={() => {
                  haptic.select();
                  onChange(o.symbol);
                  setOpen(false);
                  setQuery("");
                }}
                style={{ width: "100%", minHeight: 52, display: "flex", alignItems: "center", gap: 12, padding: "8px 4px", textAlign: "left" }}
              >
                <TokenLogo symbol={o.symbol} size={32} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 15, color: "var(--ink)" }}>{o.name}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>{o.symbol}</span>
                </span>
                {on && <Icon name="check" size={18} stroke={2.4} style={{ color: "var(--primary)", flex: "none" }} />}
              </button>
            );
          })}
          {shown.length === 0 && (
            <div style={{ padding: "22px 4px", fontSize: 14, color: "var(--ink-2)", textAlign: "center" }}>
              No stock matches “{query.trim()}”. Try the company’s name.
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
