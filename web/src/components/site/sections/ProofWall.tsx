"use client";

// The proof strip: one quiet line under the hero buttons with three numbers
// from Vera's real on-chain record (/api/vera-record, public, no auth), each
// ticking up once. It renders only when the numbers are there; while loading
// or when the API is unavailable it renders nothing at all (no dashes, no box).
// The record is Mantle's (where the signed-plan contract has run), so the line
// says so: on a page that leads with BNB Chain an unlabelled number would read
// as BNB Chain's.
//
// Plain fetch on purpose: `/` renders without a QueryClient when Privy is not
// configured (see app/providers.tsx), so react-query is not safe here.
import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { getChain } from "@/lib/chains";
import { usdWhole } from "@/lib/format";
import { NumberTicker } from "@/components/site/ui/NumberTicker";
import s from "./ProofWall.module.css";

const MANTLE = getChain("mantle");

interface ApiResponse {
  record: {
    totalRecommendations: number;
    totalExecutedUsd: number;
    executedCount: number;
  };
}

function useVeraRecord(): ApiResponse["record"] | null {
  const [record, setRecord] = useState<ApiResponse["record"] | null>(null);
  useEffect(() => {
    let alive = true;
    // A hanging API must fall through to "nothing", not load forever.
    fetch(`/api/vera-record?chain=${MANTLE.key}`, { signal: AbortSignal.timeout(8000) })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as ApiResponse;
      })
      .then((data) => alive && setRecord(data.record))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return record;
}

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

export function ProofWall() {
  const record = useVeraRecord();
  if (!record || record.totalRecommendations <= 0) return null;

  return (
    <p className={s.strip} aria-label={`Vera's record on ${MANTLE.name}`}>
      <BadgeCheck size={16} strokeWidth={2.2} className={s.mark} aria-hidden="true" />
      <span className={s.item}>
        <NumberTicker value={record.totalRecommendations} format={whole} className={s.n} /> plans signed
      </span>
      <span className={s.dot} aria-hidden="true" />
      <span className={s.item}>
        <NumberTicker value={record.totalExecutedUsd} format={usdWhole} className={s.n} /> invested
      </span>
      <span className={s.dot} aria-hidden="true" />
      <span className={s.item}>
        <NumberTicker value={record.executedCount} format={whole} className={s.n} /> checks passed on {MANTLE.name}
      </span>
    </p>
  );
}
