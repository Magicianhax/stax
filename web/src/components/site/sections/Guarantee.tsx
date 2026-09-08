"use client";

// The guarantee — "Advice a contract checks." The mechanism as a six-step
// diagram on the 12-column grid (two columns per step) whose connecting line
// draws itself as the section scrolls (ScrollTrigger scrub on
// stroke-dashoffset; without JS or under reduced motion the line is simply
// drawn).
//
// Under it, the four things the contract refuses. This used to be a table of
// hex addresses, which is proof only to someone already holding a block
// explorer: it asks the reader to take the interesting part on faith and gives
// them the boring part in full. The refusals are the actual promise, each one a
// real revert in StaxExecutor and InferenceVerifier, and the addresses stay one
// click away behind the verified links rather than on the page.
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

const REFUSALS: { title: string; note: string }[] = [
  {
    title: "A plan Vera didn’t sign",
    note: "Her signature is recovered on chain and checked against her registered identity. Anything else reverts.",
  },
  {
    title: "Risk above the ceiling you set",
    note: "You choose the number. The contract compares the plan’s assessed risk against it and stops there.",
  },
  {
    title: "An asset or venue off the list",
    note: "Only approved tokens, bought through approved routers. There is no path to anything else.",
  },
  {
    title: "A cent more than you approved",
    note: "What was actually spent is measured after the trades, not promised before them, and has to fit.",
  },
];

/** The chains the contracts are live on, for the one quiet line of proof. */
const CHAINS: StaxChain[] = [BASE, MANTLE];

/**
 * The verified links. The executor is the contract that moves the money, so it
 * is the one worth opening; naming the explorer rather than printing the address
 * keeps the proof and drops the forty characters nobody reads.
 */
function VerifiedLinks() {
  const live = CHAINS.filter((c) => c.contracts.deployed);
  if (live.length === 0) return null;
  return (
    <p className={s.verified}>
      Live and verified on{" "}
      {live.map((chain, i) => (
        <span key={chain.key}>
          {i > 0 && <span aria-hidden> · </span>}
          <a
            className={s.verifiedLink}
            href={explorerAddress(chain, chain.contracts.executor)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src={chain.brand.logo} alt="" width={16} height={16} className={s.chainLogo} />
            {chain.name}
            <ArrowUpRight size={13} strokeWidth={2.4} aria-hidden className={s.arrow} />
          </a>
        </span>
      ))}
    </p>
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

        <Reveal className={s.refusals} stagger={0.05}>
          <p className={s.eyebrow}>What it refuses</p>
          {REFUSALS.map((r) => (
            <div key={r.title} className={s.refusal}>
              <h3 className={s.refusalTitle}>{r.title}</h3>
              <p className={s.refusalNote}>{r.note}</p>
            </div>
          ))}
          <VerifiedLinks />
        </Reveal>
      </div>
    </section>
  );
}
