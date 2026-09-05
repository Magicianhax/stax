"use client";

// First viewport: the promise on the left (7 columns), the proof wall on the
// right (5). The ledger-grid ground is drawn in CSS on this section and fades
// at the edges with a mask. The entrance is one orchestrated stagger (60ms
// steps) and nothing else on the section moves afterwards.
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { FilmLightbox } from "@/components/site/FilmLightbox";
import { Reveal } from "@/components/site/motion";
import { ProofWall } from "./ProofWall";
import { AwardMark } from "./Awards";
import s from "./Hero.module.css";

export function Hero() {
  const [filmOpen, setFilmOpen] = useState(false);

  return (
    <section className={s.hero} id="top" aria-labelledby="hero-title">
      <div className={`site-wrap ${s.grid}`}>
        <div className={s.copy}>
          <Reveal as="p" className={s.kicker}>
            <AwardMark size={20} className={s.kickerMark} />
            <AwardMark size={20} className={s.kickerMark} />
            <span>Two wins, Mantle Turing Test Hackathon 2026</span>
          </Reveal>

          <Reveal
            as="h1"
            delay={60}
            id="hero-title"
            className={`serif ${s.h1}`}
          >
            Own the best companies. Ask in plain words.
          </Reveal>

          <Reveal as="p" delay={120} className={s.sub}>
            Say a goal. Vera builds the plan, a contract checks it, you own it.
          </Reveal>

          <Reveal delay={180} className={s.ctas}>
            <Link href="/app" className="btn btn-primary">
              Open Stax <ArrowRight size={18} strokeWidth={2.2} />
            </Link>
            <Link href="/demo" className="btn btn-glass">
              Try the demo
            </Link>
          </Reveal>

          <Reveal delay={240} className={s.subRow}>
            <button
              type="button"
              className={s.film}
              onClick={() => setFilmOpen(true)}
            >
              <Play size={14} strokeWidth={2.4} aria-hidden="true" /> Watch the
              film
            </button>
          </Reveal>
        </div>

        <Reveal delay={200} className={s.wall}>
          <ProofWall />
        </Reveal>
      </div>

      {filmOpen && <FilmLightbox onClose={() => setFilmOpen(false)} />}
    </section>
  );
}
