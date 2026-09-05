"use client";

// The proof wall: Vera's real on-chain record, read from /api/vera-record
// (public, no auth). Three stats count up once when the panel enters; the
// recent-recommendations list ticks one row in from the top every 6 seconds
// (transform + opacity only). If the chain has no rows yet, the panel shows
// the six mechanism steps instead. Nothing here is ever made up: an error or
// an empty record renders the mechanism, never sample rows.
//
// Plain fetch on purpose: `/` renders without a QueryClient when Privy is not
// configured (see app/providers.tsx), so react-query is not safe here.
import { useEffect, useRef, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { getChain, type ChainKey } from "@/lib/chains";
import { usd, usdWhole, timeAgo, shortAddress, riskLabel } from "@/lib/format";
import {
  useCountUp,
  useMediaQuery,
  usePrefersReducedMotion,
} from "@/components/site/motion";
import s from "./ProofWall.module.css";

const BASE = getChain("base");
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

interface VeraRecord {
  totalRecommendations: number;
  totalExecutedUsd: number;
  executedCount: number;
  recentRecommendations: Row[];
}

interface ApiResponse {
  chain: ChainKey;
  deployed: boolean;
  record: VeraRecord;
  reputation: string | null;
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: ApiResponse };

// The six moves of the mechanism, one verb each: shown when a chain has no rows.
const MECHANISM = ["Say", "Build", "Sign", "Verify", "Buy", "Record"];

const TICK_MS = 6000;
const SLIDE_MS = 640;

function useVeraRecord(chain: ChainKey): State {
  // One slot per chain so switching tabs never flashes stale data as "loading".
  const [states, setStates] = useState<Partial<Record<ChainKey, State>>>({});
  useEffect(() => {
    let alive = true;
    const put = (next: State) =>
      alive && setStates((prev) => ({ ...prev, [chain]: next }));
    fetch(`/api/vera-record?chain=${chain}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as ApiResponse;
      })
      .then((data) => put({ status: "ready", data }))
      .catch(() => put({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [chain]);
  return states[chain] ?? { status: "loading" };
}

function Stat({
  label,
  value,
  format,
  start,
  known,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  start: boolean;
  known: boolean;
}) {
  const n = useCountUp(value, { start: start && known, duration: 1400 });
  return (
    <div className={s.stat}>
      <span className={s.statValue}>{known ? format(n) : "—"}</span>
      <span className={s.statLabel}>{label}</span>
    </div>
  );
}

export function ProofWall() {
  const [chain, setChain] = useState<ChainKey>("mantle");
  const state = useVeraRecord(chain);
  const reduced = usePrefersReducedMotion();
  const phone = useMediaQuery("(max-width: 1023px)");
  const visibleCount = phone ? 3 : 5;

  // Count-up starts when the panel enters the viewport, once.
  const panelRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setEntered(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setEntered(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const known = state.status === "ready";
  const rows =
    state.status === "ready" ? state.data.record.recentRecommendations : [];
  const total =
    state.status === "ready" ? state.data.record.totalRecommendations : 0;
  const invested =
    state.status === "ready" ? state.data.record.totalExecutedUsd : 0;
  const reputation =
    state.status === "ready" && state.data.reputation !== null
      ? Number(state.data.reputation)
      : 0;

  // Feed tick: rotate the window one row at a time. `head` points at the row on
  // top; while sliding, one extra row (the one leaving) is kept at the bottom.
  const [head, setHead] = useState(0);
  const [sliding, setSliding] = useState(false);
  const rotates = rows.length > visibleCount;
  useEffect(() => {
    if (!rotates || !entered) return;
    const id = window.setInterval(() => {
      setHead((h) => (h - 1 + rows.length) % rows.length);
      if (!reduced) {
        setSliding(true);
        window.setTimeout(() => setSliding(false), SLIDE_MS);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [rotates, entered, rows.length, reduced]);

  const shown: Row[] = [];
  if (rows.length) {
    const n =
      Math.min(rows.length, visibleCount) + (sliding && rotates ? 1 : 0);
    for (let i = 0; i < n; i++) shown.push(rows[(head + i) % rows.length]);
  }

  const chainName = chain === "base" ? BASE.name : MANTLE.name;
  const explorerName =
    chain === "base" ? BASE.explorer.name : MANTLE.explorer.name;
  const baseLive = BASE.contracts.deployed;

  return (
    <div className={s.panel} ref={panelRef} aria-live="off">
      <div className={s.head}>
        <h2 className={s.title}>
          <BadgeCheck
            size={18}
            strokeWidth={2.2}
            className={s.titleMark}
            aria-hidden="true"
          />
          Every recommendation, signed and verified on-chain
        </h2>
        <div
          className={s.chains}
          role={baseLive ? "tablist" : undefined}
          aria-label="Network"
        >
          {baseLive ? (
            (["mantle", "base"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={chain === k}
                className={`${s.chip} ${chain === k ? s.chipOn : ""}`}
                onClick={() => setChain(k)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getChain(k).brand.logo}
                  alt=""
                  width={14}
                  height={14}
                  className={s.chipLogo}
                />
                {getChain(k).name}
              </button>
            ))
          ) : (
            <>
              <span className={`${s.chip} ${s.chipOn}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={MANTLE.brand.logo}
                  alt=""
                  width={14}
                  height={14}
                  className={s.chipLogo}
                />
                {MANTLE.name}
              </span>
              <span className={`${s.chip} ${s.chipSoon}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={BASE.brand.logo}
                  alt=""
                  width={14}
                  height={14}
                  className={s.chipLogo}
                />
                {BASE.name} · launching
              </span>
            </>
          )}
        </div>
      </div>

      <div className={s.stats}>
        <Stat
          label="plans built"
          value={total}
          format={(n) => Math.round(n).toLocaleString("en-US")}
          start={entered}
          known={known}
        />
        <Stat
          label="invested"
          value={invested}
          format={(n) => usdWhole(n)}
          start={entered}
          known={known}
        />
        <Stat
          label="reputation"
          value={reputation}
          format={(n) => Math.round(n).toLocaleString("en-US")}
          start={entered}
          known={known && state.data.reputation !== null}
        />
      </div>

      {shown.length > 0 ? (
        <div
          className={s.feedClip}
          style={{ height: `${Math.min(rows.length, visibleCount) * 52}px` }}
        >
          <ol
            className={`${s.feed} ${sliding ? s.feedSlide : ""}`}
            aria-label={`Recent recommendations on ${chainName}`}
          >
            {shown.map((r, i) => {
              const risk = riskLabel(r.riskScore);
              const leaving = sliding && rotates && i === shown.length - 1;
              return (
                <li
                  key={r.txHash + r.planId}
                  className={`${s.row} ${leaving ? s.rowOut : ""}`}
                >
                  <span className={`${s.risk}`}>
                    {risk.value}%{" "}
                    <em className={s.riskWord}>{risk.label.toLowerCase()}</em>
                  </span>
                  <span className={`${s.amount}`}>
                    {r.usdcSpent !== undefined ? (
                      usd(r.usdcSpent)
                    ) : (
                      <span className={s.planOnly}>plan only</span>
                    )}
                  </span>
                  <span className={`${s.when} mono`}>
                    {r.timestamp
                      ? timeAgo(r.timestamp)
                      : `#${r.blockNumber.toLocaleString("en-US")}`}
                  </span>
                  <a
                    className={s.link}
                    href={r.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${shortAddress(r.txHash)} on ${explorerName}`}
                  >
                    <span className="mono">{shortAddress(r.txHash)}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <ol
          className={s.mechanism}
          aria-label="How a recommendation becomes a record"
        >
          {MECHANISM.map((step, i) => (
            <li key={step} className={s.step}>
              <span className={s.stepN}>{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      )}

      <p className={s.foot}>
        {state.status === "loading" &&
          "Reading the record on " + chainName + "…"}
        {state.status === "error" &&
          "The record could not be read just now. The contracts and every past record stay public on " +
            explorerName +
            "."}
        {state.status === "ready" &&
          rows.length === 0 &&
          (chain === "base" && !baseLive
            ? "Stax on Base is being switched on. Vera's Mantle record is above."
            : "No recommendations on " +
              chainName +
              " yet. The first one will appear here.")}
        {state.status === "ready" &&
          rows.length > 0 &&
          `Live from ${chainName}. Every row links to the signed transaction on ${explorerName}.`}
      </p>
    </div>
  );
}
