// PhoneChrome — a static phone frame around a real screenshot of the app.
//
// The screenshots in public/brand/screens/ are captured from /demo at 390×844
// (2× → 780×1688) with the app's own 52px status-bar padding, so the island and
// clock drawn here sit over the aurora, never over content. No live app is
// mounted on the landing; this is an image in a bezel, nothing more.
import Image from "next/image";
import s from "./PhoneChrome.module.css";

export type PhoneScreen = "home" | "goal" | "plan" | "success" | "baskets" | "market";

const SCREEN_W = 390;
const SCREEN_H = 844;

/** Alt text describes what the screen shows, in the product's own words. */
const ALT: Record<PhoneScreen, string> = {
  home: "The Stax home screen: total balance, an “Invest with Vera” button, a row of baskets, and the stocks you own.",
  goal: "The goal screen: a $200 amount and the goal “Grow $200, mostly big tech, keep some safe” typed in plain words, with a “Build my plan” button.",
  plan: "Vera's plan: a balanced mix with Nvidia, Apple, Google and Safe Dollars, a one-line reason for each, and an “Invest $200” button.",
  success: "The success screen: “You're invested.” with the four holdings now owned and a note that Vera recorded the plan on-chain.",
  baskets: "The Baskets screen: ready-made mixes like Big Tech and AI & Chips, each with its weight bar and risk word.",
  market: "The Market screen: Nvidia, Google, Apple, Meta and SpaceX with live prices and a search field.",
};

export function PhoneChrome({
  screen,
  alt,
  sizes = "(min-width: 900px) 368px, 72vw",
  priority = false,
  className,
}: {
  screen: PhoneScreen;
  /** Override the default description when the surrounding copy already says it. */
  alt?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`${s.phone}${className ? ` ${className}` : ""}`}>
      <div className={s.screen}>
        <Image
          src={`/brand/screens/${screen}.png`}
          alt={alt ?? ALT[screen]}
          width={SCREEN_W}
          height={SCREEN_H}
          sizes={sizes}
          priority={priority}
          className={s.img}
        />
        <div className={s.status} aria-hidden>
          <span className={s.time}>9:41</span>
          <span className={s.island} />
          <span className={s.sys}>
            <svg viewBox="0 0 18 12" className={s.ic} fill="currentColor">
              <rect x="0" y="8" width="3" height="4" rx="1" />
              <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
              <rect x="10" y="3" width="3" height="9" rx="1" />
              <rect x="15" y="0.5" width="3" height="11.5" rx="1" />
            </svg>
            <svg viewBox="0 0 16 12" className={s.ic} fill="currentColor">
              <path d="M8 2C5 2 2.3 3.2 0.4 5.1L2 6.8C3.6 5.3 5.7 4.4 8 4.4s4.4.9 6 2.4l1.6-1.7C13.7 3.2 11 2 8 2z" />
              <path d="M8 6.4c-1.6 0-3.1.6-4.2 1.7l1.6 1.7C6 9 6.9 8.6 8 8.6s2 .4 2.6 1.2l1.6-1.7C11.1 7 9.6 6.4 8 6.4z" />
              <circle cx="8" cy="11" r="1.1" />
            </svg>
            <svg viewBox="0 0 27 13" className={`${s.ic} ${s.batt}`} fill="none">
              <rect x="0.6" y="0.6" width="22.8" height="11.8" rx="3.4" stroke="currentColor" strokeOpacity="0.45" />
              <rect x="2" y="2" width="18" height="9" rx="2" fill="currentColor" />
              <path d="M25.2 4.4c.9.3.9 3.9 0 4.2z" fill="currentColor" fillOpacity="0.45" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
