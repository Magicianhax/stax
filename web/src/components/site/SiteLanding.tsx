"use client";

// Direction contract (docs/LANDING.md, "Proof wall", seed e0aa85b4, structure #3).
//
// THESIS: Advice you can audit. The page proves Stax instead of describing it:
// the first viewport puts the promise beside a wall of real on-chain records
// and two third-party awards. No centered hero, floating phone, feature grid
// or embedded demo.
// OWN-WORLD: paper ground with a faint ruled ledger grid (1px --s-line every
// 8px one way, 64px the other, fading at the edges), sage for the one action,
// terracotta only for on-chain marks, glass panels for proof, mono for hashes
// and amounts. One orchestrated entrance, a live ticking feed, numbers that
// count up once, an SVG line that draws itself for the guarantee. No parallax,
// no autoplaying video.
// STORY: a first-time investor on a phone understands "real stocks, an AI a
// contract checks before money moves, two awards", believes it because the
// records are real and linkable, and opens Stax or the demo.
// FIRST VIEWPORT (desktop): 7/5 columns, promise left, proof wall right; mobile
// stacks with 3 wall rows under the CTAs. Copy budget: hero ≤ 30 words, every
// other section a heading and the thing itself; the two award tweets sit after
// the guarantee as static cards.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the
// finish review and the verdict.
import { useEffect, useRef } from "react";
import { useMediaQuery } from "@/components/site/motion";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/sections/Hero";
import { Awards } from "@/components/site/sections/Awards";
import { HowItWorks } from "@/components/site/sections/HowItWorks";
import { Guarantee } from "@/components/site/sections/Guarantee";
import { Baskets } from "@/components/site/sections/Baskets";
import { Assets } from "@/components/site/sections/Assets";
import { Faq } from "@/components/site/sections/Faq";
import { Closing } from "@/components/site/sections/Closing";

// Runs before hydration so a dark-system visitor never sees a light flash.
// Mirrors the matchMedia read in useMediaQuery below.
const MODE_SCRIPT =
  "try{var r=document.querySelector('.site');if(r&&matchMedia('(prefers-color-scheme: dark)').matches)r.setAttribute('data-mode','dark')}catch(e){}";

export function SiteLanding() {
  const rootRef = useRef<HTMLDivElement>(null);
  // System theme, live. The pre-hydration script below sets the same attribute
  // before first paint; useSyncExternalStore then takes over.
  const dark = useMediaQuery("(prefers-color-scheme: dark)");

  // Shared basket links may land on the root (`/?basket=…`): forward them to the
  // app, which decodes and opens the basket. Plain navigation, no router needed.
  useEffect(() => {
    const url = new URL(window.location.href);
    const basket = url.searchParams.get("basket");
    if (basket) window.location.replace(`/app?basket=${encodeURIComponent(basket)}`);
  }, []);

  // data-ready gates every scroll reveal (globals.css), so content is fully
  // visible whenever JS has not run. Set on the DOM node, not in state.
  useEffect(() => {
    rootRef.current?.setAttribute("data-ready", "true");
  }, []);

  return (
    <>
      <div className="site" ref={rootRef} data-mode={dark ? "dark" : "light"} suppressHydrationWarning>
        <Nav />
        <Hero />
        <HowItWorks />
        <Guarantee />
        <Awards />
        <Baskets />
        <Assets />
        <Faq />
        <Closing />
      </div>
      <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
    </>
  );
}
