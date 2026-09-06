// Theme for the prototype scenes: read from `.site[data-mode]` and the site
// tokens at mount, then followed live through a MutationObserver (the page's
// `D` key flips the attribute). Same technique as HeroStack.
import { useEffect, useState } from "react";

export type Mode = "light" | "dark";

export interface Theme {
  mode: Mode;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  paper: string;
  surface: string;
  primary: string;
  primaryD: string;
  accent: string;
  accent2: string;
  gold: string;
}

export function readTheme(): Theme {
  const el = document.querySelector<HTMLElement>(".site") ?? document.documentElement;
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const mode: Mode = el.getAttribute("data-mode") === "dark" ? "dark" : "light";
  const dark = mode === "dark";
  return {
    mode,
    ink: get("--s-ink", dark ? "#eef2ea" : "#232a24"),
    ink2: get("--s-ink-2", dark ? "#a8b0a2" : "#545d52"),
    ink3: get("--s-ink-3", dark ? "#969d92" : "#66705c"),
    line: dark ? "rgba(255,255,255,0.26)" : "rgba(40,52,38,0.26)",
    paper: get("--s-paper", dark ? "#11150f" : "#eef1e8"),
    surface: get("--s-surface", dark ? "#1b2018" : "#ffffff"),
    primary: get("--s-primary", dark ? "#6cc09c" : "#57a07e"),
    primaryD: get("--s-primary-d", dark ? "#57a07e" : "#3f8765"),
    accent: get("--s-accent", dark ? "#ecab7e" : "#e3a06f"),
    accent2: get("--s-accent-2", dark ? "#e3995f" : "#d98a5a"),
    gold: get("--s-gold", dark ? "#d6b878" : "#c9a86a"),
  };
}

/** Client-only (the variants load with ssr: false), so the first render reads the DOM. */
export function useSiteTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const el = document.querySelector(".site");
    if (!el) return;
    const mo = new MutationObserver(() => setTheme(readTheme()));
    mo.observe(el, { attributes: true, attributeFilter: ["data-mode"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}
