"use client";

// Direction contract (docs/LANDING.md, "Proof wall", seed e0aa85b4, structure #3).
//
// THESIS: Advice you can audit. The page proves Stax instead of describing it:
// the first viewport puts the promise beside a wall of real on-chain records
// and two third-party awards. No centered hero, floating phone, feature grid
// or embedded demo.
// OWN-WORLD: paper ground with a sparse breathing dot field under the hero
// only, sage for the one action, terracotta only for on-chain marks, glass
// panels for proof, mono for hashes and amounts. One staggered entrance per
// section, numbers that tick up once, a beam that travels the proof wall's
// border, hover that lifts. No parallax, no autoplaying video.
// STORY: a first-time investor on a phone understands "real stocks, an AI a
// contract checks before money moves, two awards", believes it because the
// records are real and linkable, and opens Stax or the demo.
// FIRST VIEWPORT (desktop): 7/5 columns. Left: kicker with both rosettes
// ("Winner · Trading & Strategy · Best UI/UX", muted "Mantle Turing Test
// Hackathon 2026"), H1 "Say it. Own it.", one sentence, "Open Stax" /
// "Try the demo", "Watch the film". Right: one glass card, three real numbers,
// the latest record. Mobile stacks on the same 24px gutter.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the
// finish review and the verdict.
import { useEffect } from "react";
import { useMediaQuery } from "@/components/site/ui/useMediaQuery";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/sections/Hero";
import { HowItWorks } from "@/components/site/sections/HowItWorks";
import { Guarantee } from "@/components/site/sections/Guarantee";
import { Awards } from "@/components/site/sections/Awards";
import { Baskets } from "@/components/site/sections/Baskets";
import { Assets } from "@/components/site/sections/Assets";
import { Faq } from "@/components/site/sections/Faq";
import { Closing } from "@/components/site/sections/Closing";
import { captureRef } from "@/lib/referral";

// Runs before hydration so a dark-system visitor never sees a light flash.
// Mirrors the matchMedia read in useMediaQuery below.
const MODE_SCRIPT =
  "try{var r=document.querySelector('.site');if(r&&matchMedia('(prefers-color-scheme: dark)').matches)r.setAttribute('data-mode','dark')}catch(e){}";

export function SiteLanding() {
  // System theme, live. The pre-hydration script below sets the same attribute
  // before first paint; useSyncExternalStore then takes over.
  const dark = useMediaQuery("(prefers-color-scheme: dark)");

  // Shared basket links may land on the root (`/?basket=…`): forward them to the
  // app, which decodes and opens the basket. Plain navigation, no router needed.
  // A `?ref=CODE` (beta referral) is kept for the join and stripped from the URL.
  useEffect(() => {
    captureRef();
    const url = new URL(window.location.href);
    const basket = url.searchParams.get("basket");
    if (basket) window.location.replace(`/app?basket=${encodeURIComponent(basket)}`);
  }, []);

  return (
    <>
      <div className="site" data-mode={dark ? "dark" : "light"} suppressHydrationWarning>
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
