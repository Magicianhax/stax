"use client";

// One quiet row of four counts. Labels above numbers, hairlines between.
import type { AdminStats } from "@/hooks/useAdminBeta";
import s from "./admin.module.css";

const NUM = new Intl.NumberFormat("en-US");

export function StatsStrip({ stats }: { stats: AdminStats | null }) {
  const items: { label: string; value: number | null }[] = [
    { label: "Waiting", value: stats?.waiting ?? null },
    { label: "Approved", value: stats?.approved ?? null },
    { label: "Blocked", value: stats?.blocked ?? null },
    { label: "Referrals", value: stats?.referrals ?? null },
  ];
  return (
    <div className={`card ${s.stats}`} aria-label="List totals">
      {items.map((it) => (
        <div key={it.label} className={s.stat}>
          <div className={s.statLabel}>{it.label}</div>
          {it.value == null ? (
            <div className={`skeleton ${s.statSkeleton}`} aria-hidden />
          ) : (
            <div className={s.statValue}>{NUM.format(it.value)}</div>
          )}
        </div>
      ))}
    </div>
  );
}
