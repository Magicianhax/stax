"use client";

// The guarantee — "Advice a contract checks." The mechanism as a six-step
// diagram on the 12-column grid (two columns per step) whose connecting line
// draws itself as the section scrolls (ScrollTrigger scrub on
// stroke-dashoffset; without JS or under reduced motion the line is simply
// drawn). Under it, the verified contracts as a 12-column table: name 4 cols,
// mono address 6 cols, explorer link 2 cols. Names, explorers and addresses
// come from the chain registry so nothing is typed here.
import { useRef } from "react";
import Image from "next/image";
import {
  ArrowLeftRight,
  ArrowUpRight,
  MessageSquareText,
  PenLine,
  ScrollText,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { BASE, MANTLE, explorerAddress, type StaxChain } from "@/lib/chains";
import { gsap, useGSAP, MOTION_OK } from "../ui/gsap";
import { Reveal } from "../ui/Reveal";
import l from "../layout.module.css";
import s from "./Guarantee.module.css";

const STEPS: { icon: LucideIcon; title: string; onchain?: boolean }[] = [
  { icon: MessageSquareText, title: "You say the goal" },
  { icon: Sparkles, title: "Vera builds a plan" },
  { icon: PenLine, title: "Vera signs it", onchain: true },
  { icon: ShieldCheck, title: "A contract checks, or refuses", onchain: true },
  { icon: ArrowLeftRight, title: "Your buys go through", onchain: true },
  { icon: ScrollText, title: "The record is public", onchain: true },
];

// Node centres on a 600-unit strip; the SVGs stretch to the grid and
// non-scaling strokes keep the line 2px.
const N = STEPS.length;
const centres = Array.from({ length: N }, (_, i) => ((i + 0.5) / N) * 600);
const ACROSS = centres
  .map((x, i) => {
    if (i === 0) return `M${x} 28`;
    const px = centres[i - 1];
    const dip = i % 2 ? 44 : 12;
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

const CONTRACT_ROWS: {
  key: "executor" | "verifier" | "registry";
  name: string;
  does: string;
}[] = [
  { key: "verifier", name: "Verifier", does: "checks Vera's signature and the risk" },
  { key: "executor", name: "Executor", does: "moves the money, only after the check" },
  { key: "registry", name: "Identity registry", does: "Vera's identity, on record" },
];

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ChainRows({ chain }: { chain: StaxChain }) {
  return (
    <>
      <div className={s.chainHead}>
        <span className={s.chainCell}>
          <Image src={chain.brand.logo} alt="" width={18} height={18} className={s.chainLogo} />
          {chain.name}
        </span>
        <span className={s.chainNote}>
          {chain.contracts.deployed ? `verified on ${chain.explorer.name}` : "launching"}
        </span>
        <span className={s.chainNote} aria-hidden />
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
              <span className={s.name}>
                {row.name}
                <span className={s.does}>{row.does}</span>
              </span>
              <span className={s.addr} title={addr}>
                <span className={s.addrFull}>{addr}</span>
                <span className={s.addrShort}>{short(addr)}</span>
              </span>
              <span className={s.link}>
                {chain.explorer.name}
                <ArrowUpRight size={14} strokeWidth={2.4} aria-hidden className={s.arrow} />
              </span>
            </a>
          );
        })
      ) : (
        <div className={`${s.row} ${s.rowStatic}`}>
          <span className={s.name}>
            Same three contracts
            <span className={s.does}>being switched on for {chain.name}</span>
          </span>
          <span className={s.addr}>addresses appear here once live</span>
          <span className={s.link} aria-hidden />
        </div>
      )}
    </>
  );
}

export function Guarantee() {
  const scope = useRef<HTMLDivElement>(null);

  // The line draws with the scroll. Only under motion-ok: the CSS default is
  // "drawn", so reduced motion and no-JS both see the finished route.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          `.${s.ink}`,
          { strokeDashoffset: 1 },
          {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: {
              trigger: scope.current,
              start: "top 82%",
              end: "bottom 55%",
              scrub: 0.5,
            },
          },
        );
      });
    },
    { scope },
  );

  return (
    <section className={l.sec} id="guarantee" aria-labelledby="guarantee-title">
      <div className={l.wrap}>
        <div className={l.head}>
          <h2 id="guarantee-title" className={l.h2}>
            Advice a contract checks.
          </h2>
        </div>

        <div className={s.diagram} ref={scope}>
          {/* one line, drawn by scroll; the ghost underneath shows the route from the start */}
          <svg className={`${s.line} ${s.across}`} viewBox="0 0 600 56" preserveAspectRatio="none" aria-hidden>
            <path d={ACROSS} className={s.ghost} vectorEffect="non-scaling-stroke" />
            <path d={ACROSS} className={s.ink} pathLength={1} vectorEffect="non-scaling-stroke" />
          </svg>
          <svg className={`${s.line} ${s.down}`} viewBox="0 0 48 600" preserveAspectRatio="none" aria-hidden>
            <path d={DOWN} className={s.ghost} vectorEffect="non-scaling-stroke" />
            <path d={DOWN} className={s.ink} pathLength={1} vectorEffect="non-scaling-stroke" />
          </svg>

          <Reveal as="ol" className={`${l.grid} ${s.steps}`} stagger={0.06}>
            {STEPS.map((st) => (
              <li key={st.title} className={s.step} data-onchain={st.onchain ? "1" : undefined}>
                <span className={s.disc} aria-hidden>
                  <st.icon size={22} strokeWidth={1.9} />
                </span>
                <h3 className={s.stepTitle}>{st.title}</h3>
              </li>
            ))}
          </Reveal>
        </div>

        <Reveal className={s.table} stagger={0.04}>
          <ChainRows chain={MANTLE} />
          <ChainRows chain={BASE} />
        </Reveal>
      </div>
    </section>
  );
}
