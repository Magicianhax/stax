"use client";

import { useEffect, useState } from "react";
import type { AdminRow } from "@/hooks/useAdminBeta";
import { toMs } from "@/hooks/useAdminBeta";
import { shortAddress as short } from "@/lib/format";

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** shortAddress that passes null through (table + previews). */
export function shortAddress(addr: string | null | undefined): string | null {
  return addr ? short(addr) : null;
}

/** CSV of the given rows (the current filter, loaded pages only). */
export function rowsToCsv(rows: AdminRow[]): string {
  const cols: (keyof AdminRow)[] = [
    "position", "email", "address", "status", "refCode", "referredBy", "referrals",
    "createdAt", "approvedAt", "userId", "source", "note", "id",
  ];
  const cell = (v: unknown): string => {
    if (v == null) return "";
    const str = String(v);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const iso = (v: AdminRow["createdAt"] | null) => {
    const ms = toMs(v);
    return ms == null ? "" : new Date(ms).toISOString();
  };
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(
      cols
        .map((c) => (c === "createdAt" || c === "approvedAt" ? iso(r[c]) : cell(r[c])))
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function downloadText(name: string, text: string, type = "text/csv") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
