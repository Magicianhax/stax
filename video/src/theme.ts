// Stax brand tokens for the promo video.
// Mirrors web/src/app/globals.css (.site light scope) and docs/BRAND.md.
// Calm & premium: warm paper, sage primary, teal accent, soft glass.

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION_S = 30;
export const DURATION_FRAMES = DURATION_S * FPS; // 900

export const COLOR = {
  paper: "#eef1e8",
  paper2: "#e7ecdf",
  surface: "#ffffff",
  ink: "#232a24",
  ink2: "#545d52",
  ink3: "#66705c",
  line: "rgba(40, 52, 38, 0.10)",
  primary: "#57a07e",
  primaryD: "#3f8765",
  primarySoft: "#e7f3ec",
  accent: "#3f8f86",
  accentSoft: "#e3f0ee",
  pos: "#57a07e",
  neg: "#c0492f",
  white: "#ffffff",
} as const;

export const GRAD = {
  hero: "linear-gradient(135deg, #6cb38f 0%, #4f9e7c 48%, #3f8765 100%)",
  paperBg:
    "radial-gradient(1200px 700px at 18% 12%, #f3f6ee 0%, #eef1e8 55%, #e7ecdf 100%)",
} as const;

// Per-act color grade. The whole point: the canvas changes value/mood across the
// arc so the build->drop->resolve actually registers. Stats goes dark on purpose
// (a single hero contrast frame) so the white type detonates.
export const GRADES = {
  build: {
    // cooler, slightly desaturated, dimmer — tension
    bg: "radial-gradient(1240px 800px at 50% 40%, #eaeee6 0%, #e1e7dd 52%, #d6ddce 100%)",
    vignette: 0.44,
    ink: COLOR.ink,
    ink2: COLOR.ink2,
    hl: COLOR.primaryD,
    dark: false,
  },
  drop: {
    // bright sage-washed release — clearly brighter/cleaner than build
    bg: "radial-gradient(1100px 820px at 50% 44%, #f7faf1 0%, #ecf4e7 58%, #ddecd9 100%)",
    vignette: 0.18,
    ink: COLOR.ink,
    ink2: COLOR.ink2,
    hl: COLOR.primaryD,
    dark: false,
  },
  product: {
    // clean bright with a warm key from the upper-left
    bg: "radial-gradient(1300px 900px at 28% 22%, #fcfdf7 0%, #eff3e9 54%, #e6ecdd 100%)",
    vignette: 0.24,
    ink: COLOR.ink,
    ink2: COLOR.ink2,
    hl: COLOR.primaryD,
    dark: false,
  },
  stats: {
    // dark sage/ink — the deliberate contrast frame; white type pops
    bg: "radial-gradient(1200px 900px at 50% 48%, #1d2c23 0%, #131c16 58%, #0b110d 100%)",
    vignette: 0.55,
    ink: "#f1f5ee",
    ink2: "#aeb6a8",
    hl: "#7fd4ab",
    dark: true,
  },
  end: {
    // warmest resolve
    bg: "radial-gradient(1240px 840px at 50% 46%, #f8f6ed 0%, #eff2e7 54%, #e9eddc 100%)",
    vignette: 0.28,
    ink: COLOR.ink,
    ink2: COLOR.ink2,
    hl: COLOR.primaryD,
    dark: false,
  },
} as const;

export type GradeKey = keyof typeof GRADES;

export const GLASS = {
  bg: "rgba(255, 255, 255, 0.55)",
  bgStrong: "rgba(255, 255, 255, 0.72)",
  stroke: "rgba(255, 255, 255, 0.7)",
  shadow:
    "0 8px 24px rgba(60, 78, 54, 0.10), 0 24px 64px rgba(60, 78, 54, 0.12)",
  shadowLg:
    "0 8px 22px rgba(70, 84, 62, 0.12), 0 40px 90px rgba(70, 84, 62, 0.18)",
} as const;

export const RADIUS = { sm: 14, md: 18, lg: 26, xl: 36 } as const;

// Font family strings — actual @font-face loaded via @remotion/google-fonts in fonts.ts
export const FONT = {
  display: "Fraunces, Georgia, serif", // headlines / wordmark
  ui: "'Hanken Grotesk', system-ui, sans-serif", // body / captions
  mono: "'JetBrains Mono', ui-monospace, monospace", // data / hashes
} as const;
