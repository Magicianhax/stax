"use client";

// First viewport. Left, 7 columns: kicker with the two award rosettes, the
// H1, one sentence, two buttons and the film link. Right, 5 columns: the proof
// wall. The ground is the DotField (sparse breathing lattice + pointer glow),
// masked at the edges, on this section only. One staggered entrance; nothing
// else on the section moves afterwards except the wall's border beam.
import { useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import { FilmLightbox } from "@/components/site/FilmLightbox";
import { DotField } from "@/components/site/ui/DotField";
import { Reveal } from "@/components/site/ui/Reveal";
import { ShineButton } from "@/components/site/ui/ShineButton";
import L from "@/components/site/layout.module.css";
import { ProofWall } from "./ProofWall";
import { AwardMark, AWARD_EVENT } from "./Awards";
import s from "./Hero.module.css";

export function Hero() {
  const [filmOpen, setFilmOpen] = useState(false);

  return (
    <section className={`${L.sec} ${s.hero}`} id="top" aria-labelledby="hero-title">
      <DotField />
      <div className={`${L.wrap} ${L.grid} ${s.grid}`}>
        <Reveal className={s.copy} stagger={0.08}>
          <p className={s.kicker}>
            <span className={s.award}>
              <AwardMark size={18} className={s.rosette} />
              Trading &amp; Strategy winner
            </span>
            <span className={s.sep} aria-hidden="true">
              ·
            </span>
            <span className={s.award}>
              <AwardMark size={18} className={s.rosette} />
              Best UI/UX
            </span>
            <span className={s.event}>{AWARD_EVENT}</span>
          </p>

          <h1 id="hero-title" className={s.h1}>
            Say it. Own it.
          </h1>

          <p className={s.sub}>
            Tell Vera your goal in plain words. She builds a plan of real stocks, a contract checks it, and you own it
            in one tap.
          </p>

          <div className={s.ctas}>
            <ShineButton href="/app">
              Open Stax
              <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
            </ShineButton>
            <ShineButton href="/demo" variant="glass">
              Try the demo
            </ShineButton>
          </div>

          <div className={s.subRow}>
            <button type="button" className={s.film} onClick={() => setFilmOpen(true)}>
              <Play size={14} strokeWidth={2.4} aria-hidden="true" />
              Watch the film
            </button>
          </div>
        </Reveal>

        <Reveal className={s.wall}>
          <ProofWall />
        </Reveal>
      </div>

      {filmOpen && <FilmLightbox onClose={() => setFilmOpen(false)} />}
    </section>
  );
}
