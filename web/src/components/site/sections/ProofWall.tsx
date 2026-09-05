"use client";

// The proof wall: one glass card with a border beam. A header row, three
// numbers from Vera's real on-chain record (/api/vera-record, public, no
// auth) that tick up once on reveal, and one line for the latest record. A
// thin dash while loading or unavailable; the calm line when there is no
// record. Nothing here is ever made up.
//
// Plain fetch on purpose: `/` renders without a QueryClient when Privy is not
// configured (see app/providers.tsx), so react-query is not safe here.
import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { getChain } from "@/lib/chains";
import { usd, usdWhole, timeAgo, riskLabel } from "@/lib/format";
import { BorderBeam } from "@/components/site/ui/BorderBeam";
import { NumberTicker } from "@/components/site/ui/NumberTicker";
import L from "@/components/site/layout.module.css";
import s from "./ProofWall.module.css";

const MANTLE = getChain("mantle");

interface Row {
  planId: `0x${string}`;
  riskScore: number;
  usdcSpent?: number;
  txHash: `0x${string}`;
  blockNumber: number;
  explorerUrl: string;
  /** Unix seconds, when the API provides it. */
  timestamp?: number;
}

interface ApiResponse {
  record: {
    totalRecommendations: number;
    totalExecutedUsd: number;
    executedCount: number;
    recentRecommendations: Row[];
  };
}

function useVeraRecord(): ApiResponse["record"] | null {
  const [record, setRecord] = useState<ApiResponse["record"] | null>(null);
  useEffect(() => {
    let alive = true;
    // A hanging API must reach the honest fallback line, not load forever.
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
  const latest = record?.recentRecommendations[0];
  const risk = latest ? riskLabel(latest.riskScore) : null;

  return (
    <div className={`${L.card} ${s.card}`}>
      <BorderBeam />
      <p className={s.head}>
        <BadgeCheck size={18} strokeWidth={2.2} className={s.mark} aria-hidden="true" />
        Signed, then verified on-chain
      </p>

      <dl className={s.stats}>
        <div className={s.stat}>
          <dt>Plans built</dt>
          <dd>
            <NumberTicker value={record ? record.totalRecommendations : null} format={whole} />
          </dd>
        </div>
        <div className={s.stat}>
          <dt>Invested</dt>
          <dd>
            <NumberTicker value={record ? record.totalExecutedUsd : null} format={usdWhole} />
          </dd>
        </div>
        <div className={s.stat}>
          <dt>Checks passed</dt>
          <dd>
            <NumberTicker value={record ? record.executedCount : null} format={whole} />
          </dd>
        </div>
      </dl>

      <p className={s.latest}>
        {latest && risk ? (
          <>
            <span className={s.strong}>{risk.value}% risk</span>
            <span className={s.dot} aria-hidden="true" />
            <span className={s.strong}>{latest.usdcSpent !== undefined ? usd(latest.usdcSpent) : "plan only"}</span>
            <span className={s.dot} aria-hidden="true" />
            <span className="mono">
              {latest.timestamp ? timeAgo(latest.timestamp) : `#${latest.blockNumber.toLocaleString("en-US")}`}
            </span>
            <a
              className={s.link}
              href={latest.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open the latest record on ${MANTLE.explorer.name}`}
            >
              {MANTLE.explorer.name}
              <span className={s.arrow} aria-hidden="true">
                ↗
              </span>
            </a>
          </>
        ) : (
          <>Record loads from {MANTLE.name} mainnet.</>
        )}
      </p>
    </div>
  );
}
