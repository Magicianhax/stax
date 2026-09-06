"use client";

// /beta in the site world: the same `.site` wrapper, system theme and nav as
// the landing, one hero. `?ref=CODE` is kept for the join and stripped.
import { useEffect } from "react";
import { useMediaQuery } from "@/components/site/ui/useMediaQuery";
import { Nav } from "@/components/site/Nav";
import { captureRef } from "@/lib/referral";
import { BetaHero } from "./BetaHero";

const MODE_SCRIPT =
  "try{var r=document.querySelector('.site');if(r&&matchMedia('(prefers-color-scheme: dark)').matches)r.setAttribute('data-mode','dark')}catch(e){}";

export function BetaPage() {
  const dark = useMediaQuery("(prefers-color-scheme: dark)");

  useEffect(() => {
    captureRef();
  }, []);

  return (
    <>
      <div className="site" data-mode={dark ? "dark" : "light"} suppressHydrationWarning>
        <Nav />
        <BetaHero />
      </div>
      <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
    </>
  );
}
