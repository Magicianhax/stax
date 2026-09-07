"use client";

// The `.site` wrapper for pages outside the landing (legal, 404): the same
// system-theme `data-mode` and pre-hydration script SiteLanding and BetaPage
// use, so a dark-system visitor never sees a light flash. Server pages render
// their content as children.
import type { ReactNode } from "react";
import { useMediaQuery } from "@/components/site/ui/useMediaQuery";

const MODE_SCRIPT =
  "try{var r=document.querySelector('.site');if(r&&matchMedia('(prefers-color-scheme: dark)').matches)r.setAttribute('data-mode','dark')}catch(e){}";

export function SiteFrame({ children, className }: { children: ReactNode; className?: string }) {
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  return (
    <>
      <div className={className ? `site ${className}` : "site"} data-mode={dark ? "dark" : "light"} suppressHydrationWarning>
        {children}
      </div>
      <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
    </>
  );
}
