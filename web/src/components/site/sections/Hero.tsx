"use client";

// First viewport. Left, 7 columns: kicker with the two award rosettes, the
// H1, one sentence, two buttons, the film link and the proof strip. Right,
// 5 columns: the seal, a 3D signed-plan slab that stamps itself verified (three, loaded
// lazily, never server-rendered; a CSS silhouette holds its box until then).
// The ground is the DotField (sparse breathing lattice + pointer glow), masked
// at the edges, on this section only. One staggered entrance on the copy; the
// stack drops in on its own and then only floats.
import { useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, Play } from "lucide-react";
import { SealSilhouette } from "@/components/site/three/SealSilhouette";
import { FilmLightbox } from "@/components/site/FilmLightbox";
import { DotField } from "@/components/site/ui/DotField";
import { Reveal } from "@/components/site/ui/Reveal";
import { ShineButton } from "@/components/site/ui/ShineButton";
import L from "@/components/site/layout.module.css";
import { ProofWall } from "./ProofWall";
import { AwardMark, AWARD_EVENT } from "./Awards";
import s from "./Hero.module.css";

const HeroSeal = dynamic(() => import("@/components/site/three/HeroSeal"), {
  ssr: false,
  loading: () => <SealSilhouette />,
});

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

          <div className={s.proof}>
            <ProofWall />
          </div>
        </Reveal>

        <div className={s.stage} aria-hidden="true">
          <HeroSeal />
        </div>
      </div>

      {filmOpen && <FilmLightbox onClose={() => setFilmOpen(false)} />}
    </section>
  );
}
