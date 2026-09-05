"use client";

// The guarantee — "Advice a contract checks." The mechanism as a six-step
// diagram (labels only) whose connecting line draws itself as the section
// scrolls into view (one path, stroke-dashoffset from a scroll-driven --draw
// var; reduced motion = fully drawn). Under it, the verified contracts with
// explorer links, read from the chain registry so names, explorers and
// addresses are never typed here. No paragraphs: the diagram is the copy.
import { useEffect, useRef } from "react";
import Image from "next/image";
import {
  ArrowLeftRight,
  MessageSquareText,
  PenLine,
  ScrollText,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { BASE, MANTLE, explorerAddress, type StaxChain } from "@/lib/chains";
import { Reveal, usePrefersReducedMotion } from "../motion";
import story from "./story.module.css";
import s from "./Guarantee.module.css";

const STEPS: { icon: LucideIcon; title: string; onchain?: boolean }[] = [
  { icon: MessageSquareText, title: "You say the goal" },
  { icon: Sparkles, title: "Vera builds a plan" },
  { icon: PenLine, title: "Vera signs it", onchain: true },
  { icon: ShieldCheck, title: "A contract checks, or refuses", onchain: true },
  { icon: ArrowLeftRight, title: "Your buys go through", onchain: true },
  { icon: ScrollText, title: "The record is public", onchain: true },
];

// Node centres on a 600-unit-wide strip (desktop) and a 600-unit-tall strip
// (mobile); the SVGs stretch to the grid, non-scaling strokes keep the line 2px.
const N = STEPS.length;
const centres = Array.from({ length: N }, (_, i) => ((i + 0.5) / N) * 600);
const ACROSS = centres
  .map((x, i) => {
    if (i === 0) return `M${x} 28`;
    const px = centres[i - 1];
    const dip = i % 2 ? 44 : 12; // gentle alternating wave between nodes
    return `C${px + 42} ${dip} ${x - 42} ${dip} ${x} 28`;
  })
  .join(" ");
const DOWN = centres
  .map((y, i) => {
    if (i === 0) return `M24 ${y}`;
    const py = centres[i - 1];
    const sway = i % 2 ? 34 : 14;
    return `C${sway} ${py + 40} ${sway} ${y - 40} 24 ${y}`;
  })
  .join(" ");

/** Drives `--draw` (0 → 1) on `el` from scroll position. Never goes backwards. */
function useDrawOnScroll(
  el: React.RefObject<HTMLDivElement | null>,
  reduced: boolean,
) {
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (reduced) {
      node.style.setProperty("--draw", "1");
      return;
    }
    let raf = 0;
    let best = 0;
    const update = () => {
      raf = 0;
      const r = node.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // starts when the diagram's top clears the lower 12% of the viewport,
      // finishes once it has travelled a little past its own height
      const p = (vh * 0.88 - r.top) / (r.height + vh * 0.22);
      const next = Math.min(1, Math.max(0, p));
      if (next <= best) return;
      best = next;
      node.style.setProperty("--draw", next.toFixed(3));
      if (best >= 1) detach();
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const detach = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
    return () => {
      detach();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [el, reduced]);
}

const CONTRACT_ROWS: {
  key: "executor" | "verifier" | "registry";
  name: string;
  does: string;
}[] = [
  {
    key: "verifier",
    name: "Verifier",
    does: "checks Vera's signature and the risk",
  },
  {
    key: "executor",
    name: "Executor",
    does: "moves the money, only after the check",
  },
  {
    key: "registry",
    name: "Identity registry",
    does: "Vera's identity, on record",
  },
];

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ChainRows({ chain }: { chain: StaxChain }) {
  return (
    <>
      <div className={s.chainHead}>
        <Image
          src={chain.brand.logo}
          alt=""
          width={18}
          height={18}
          className={s.chainLogo}
        />
        <span className={s.chainName}>{chain.name}</span>
        {chain.contracts.deployed ? (
          <span className={s.chainNote}>verified on {chain.explorer.name}</span>
        ) : (
          <span className={s.chainNote}>launching</span>
        )}
      </div>
      {chain.contracts.deployed ? (
        CONTRACT_ROWS.map((row) => {
          const addr = chain.contracts[row.key];
          return (
            <a
              key={row.key}
              className={s.row}
              href={explorerAddress(chain, addr)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${row.name} contract on ${chain.name}, ${addr}. Open on ${chain.explorer.name}.`}
            >
              <span className={s.rowName}>
                {row.name}
                <span className={s.rowDoes}>{row.does}</span>
              </span>
              <span className={s.addr}>
                <span className={s.addrFull}>{addr}</span>
                <span className={s.addrShort}>{short(addr)}</span>
              </span>
              <span className={s.rowLink}>
                {chain.explorer.name}
                <svg
                  viewBox="0 0 16 16"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 12L12 4M6 4h6v6" />
                </svg>
              </span>
            </a>
          );
        })
      ) : (
        <div className={`${s.row} ${s.rowStatic}`}>
          <span className={s.rowName}>
            Same three contracts
            <span className={s.rowDoes}>
              being switched on for {chain.name}
            </span>
          </span>
          <span className={s.addr}>
            <span className={s.addrFull}>addresses appear here once live</span>
          </span>
          <span className={s.rowLink} aria-hidden />
        </div>
      )}
    </>
  );
}

export function Guarantee() {
  const diagram = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  useDrawOnScroll(diagram, reduced);

  return (
    <section
      className={story.sec}
      id="guarantee"
      aria-labelledby="guarantee-title"
    >
      <div className={story.wrap}>
        <Reveal className={story.head}>
          <h2 id="guarantee-title" className={story.h2}>
            Advice a contract checks.
          </h2>
        </Reveal>

        <div className={s.diagram} ref={diagram}>
          {/* one line, drawn by scroll; the faint ghost underneath shows the route from the start */}
          <svg
            className={`${s.line} ${s.across}`}
            viewBox="0 0 600 56"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d={ACROSS}
              className={s.ghost}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={ACROSS}
              className={s.ink}
              pathLength={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <svg
            className={`${s.line} ${s.down}`}
            viewBox="0 0 48 600"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d={DOWN}
              className={s.ghost}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={DOWN}
              className={s.ink}
              pathLength={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <ol className={s.steps} aria-label="How a plan is checked, in order">
            {STEPS.map((st) => (
              <li
                key={st.title}
                className={s.step}
                data-onchain={st.onchain ? "1" : undefined}
              >
                <span className={s.disc} aria-hidden>
                  <st.icon size={22} strokeWidth={1.9} />
                </span>
                <h3 className={s.stepTitle}>{st.title}</h3>
              </li>
            ))}
          </ol>
        </div>

        <Reveal className={s.ledger} delay={60}>
          <ChainRows chain={MANTLE} />
          <ChainRows chain={BASE} />
        </Reveal>
      </div>
    </section>
  );
}
