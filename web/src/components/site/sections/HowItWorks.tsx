"use client";

// How it works — "Three moves." Three real screenshots in phone frames (goal,
// plan, success) on 4+4+4 columns: same width, same top edge, label centred
// under each. The frames tilt a few degrees toward the pointer (TiltCard) and
// the row reveals once with a stagger. Nothing else.
import { Reveal } from "../ui/Reveal";
import { TiltCard } from "../ui/TiltCard";
import { PhoneChrome, type PhoneScreen } from "../PhoneChrome";
import l from "../layout.module.css";
import s from "./HowItWorks.module.css";

const MOVES: { screen: PhoneScreen; title: string }[] = [
  { screen: "goal", title: "Say it" },
  { screen: "plan", title: "See the plan" },
  { screen: "success", title: "Own it" },
];

export function HowItWorks() {
  return (
    <section className={l.sec} id="how" aria-labelledby="how-title">
      <div className={l.wrap}>
        <div className={l.head}>
          <h2 id="how-title" className={l.h2}>
            Three moves.
          </h2>
        </div>

        <Reveal as="ol" className={`${l.grid} ${s.row}`} stagger={0.08}>
          {MOVES.map((m, i) => (
            <li key={m.screen} className={s.move}>
              <TiltCard className={s.tilt} max={3}>
                <PhoneChrome screen={m.screen} className={s.phone} priority={i === 0} />
              </TiltCard>
              <h3 className={s.title}>{m.title}</h3>
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
