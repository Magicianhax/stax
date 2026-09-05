"use client";

// How it works — "Three moves." Three real screenshots in phone frames (goal,
// plan, success) with a two-or-three-word label each. Nothing else.
import { Reveal } from "../motion";
import { PhoneChrome, type PhoneScreen } from "../PhoneChrome";
import story from "./story.module.css";
import s from "./HowItWorks.module.css";

const MOVES: { screen: PhoneScreen; title: string }[] = [
  { screen: "goal", title: "Say it" },
  { screen: "plan", title: "See the plan" },
  { screen: "success", title: "Own it" },
];

export function HowItWorks() {
  return (
    <section className={story.sec} id="how" aria-labelledby="how-title">
      <div className={story.wrap}>
        <Reveal className={story.head}>
          <h2 id="how-title" className={story.h2}>
            Three moves.
          </h2>
        </Reveal>

        {/* one reveal for the row; the children stagger in CSS so a phone peeking in
            from the right on mobile is never left invisible by its own observer */}
        <Reveal>
          <ol className={s.row} aria-label="The three moves">
            {MOVES.map((m) => (
              <li key={m.screen} className={s.move}>
                <PhoneChrome screen={m.screen} className={s.phone} />
                <h3 className={s.title}>{m.title}</h3>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
