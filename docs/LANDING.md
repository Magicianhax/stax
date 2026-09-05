# Landing redesign brief — "Proof wall"

Mode: **Persuade**. Surface: `/` (`web/src/components/site/SiteLanding.tsx`). Visual world: the
established Stax world in `web/DESIGN.md` (paper/sage/terracotta, liquid glass, Fraunces display +
Hanken UI + JetBrains Mono for on-chain data). This is a new composition inside that world, not a
new brand. Seed key `e0aa85b4`, assigned structure #3 of the grounded list.

## Direction contract

- **THESIS:** *Advice you can audit.* The page proves Stax instead of describing it: the first
  viewport puts the promise beside a wall of real on-chain records and two third-party awards.
  It refuses the category default (centered hero, floating phone mockup, feature grid, embedded demo).
- **OWN-WORLD:** paper ground with a faint ruled ledger grid (1px `--s-line` every 8px in one
  direction, 64px in the other, fading toward the edges), sage primary for the one action, terracotta
  only for on-chain/trust marks, glass panels for proof, mono for hashes and amounts. One
  orchestrated entrance, a live ticking feed, numbers that count up once, an SVG line that draws
  itself for the guarantee. No scattered hover effects, no parallax, no autoplaying video.
- **STORY:** A first-time investor on a phone understands "real stocks, an AI that a contract checks
  before money moves, and people who judge products gave it two awards"; believes it because the
  records are real and linkable; acts by opening Stax or trying the demo.
- **FIRST VIEWPORT (desktop ≥1024):** two columns, 7/5. Left: kicker with both award marks
  ("Winner · Mantle Turing Test Hackathon 2026 · Best UI/UX"), H1 in Fraunces
  "Own the world's best companies. Ask in plain words.", one-sentence sub, primary "Open Stax"
  (→ `/app`) and secondary "Try the demo" (→ `/demo`), a quiet line "Gas-free · on Base and Mantle ·
  eligible non-US users". Right: the **proof wall**, a glass panel titled "Every recommendation,
  signed and verified on-chain" with three real stats (plans built, invested, Vera's reputation) and
  a live list of the last real recommendations (risk %, amount, time, explorer link) that ticks in
  one row at a time. **Mobile:** stack; the wall shows 3 rows under the CTAs.
- **FORM:** Proof wall, #3 of 7, seed `e0aa85b4`.
- **FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review and the verdict.

Put this contract, verbatim and trimmed to ≤150 words, as the opening comment of `SiteLanding.tsx`.

## Page order

1. **Nav** (glass, sticky): mark, "How it works", "Baskets", "FAQ", "Open Stax".
2. **Hero + Proof wall** (above).
3. **Awards band** — two cards, verbatim sources (July 10, 2026, @Mantle_Official):
   - *Track Winner, Mantle Turing Test Hackathon 2026* — "The Track Winners, one from each of the
     six… From autonomous trading to agentic economies and consumer apps, these builds led their
     categories start to finish." Link: https://x.com/Mantle_Official/status/2075596029408514552
   - *Best UI/UX* — "Most onchain apps hand you a manual. Stax hands you an app you already know
     how to use, clear hierarchy, full design language, and onboarding with zero friction. The kind
     of design that turns a build into something people actually use." Link:
     https://x.com/Mantle_Official/status/2075596047746027814
   Show the quote as a pull-quote, the award name, the date, "See the announcement ↗". The user
   says the track was **Trading & Strategy**; use that label for the track name.
4. **How it works** — three moves, each a real screenshot in a static phone frame: *Say it*
   (Goal screen), *See the plan* (Plan screen), *Own it* (Success screen). One line each. Reveal on
   scroll, staggered. Screenshots are captured from the running app (see Assets).
5. **The guarantee** — the mechanism as a diagram that draws itself on scroll:
   Goal → Vera builds a plan → Vera signs the risk (EIP-712) → the contract verifies or refuses →
   swaps execute → the record is public. Below: the three verified Mantle contracts with mono
   addresses and Mantlescan links (from `lib/chains/mantle.ts`), and "Base: launching" while
   `BASE.contracts.deployed` is false.
6. **Baskets** — "One tap, a whole mix." Cards from `CURATED_BASKETS.base` (real weights, real
   `WeightBar`), each links to `/app?basket=<encodeBasketLink>`.
7. **What you can own** — two marquee rows from `getChain("base").assets` (buyable) with logos,
   then a quiet line for Mantle.
8. **Built on** — Base + Coinbase, Mantle + Backed, Privy, Pimlico, Chainlink, Uniswap, Aave.
9. **FAQ** — from `lib/faq.ts`, accordion.
10. **Close** — one big line, "Open Stax", footer (links, "Stocks are issued by Coinbase on Base and
    Backed on Mantle for eligible non-US users", © 2026).

## Assets

- Screenshots: capture from the dev server already running at http://localhost:3000/demo at 390×844,
  deviceScaleFactor 2, into `web/public/brand/screens/{goal,plan,success,home,baskets,market}.png`
  (PNG, keep each ≤ 350 KB; crop to the phone viewport, no browser chrome). Navigate via the demo
  UI (Home → type a goal → Plan → place → Success). Never kill that server; you cannot start a
  second one in this directory.
- Awards: no image needed; a small SVG laurel/rosette mark in `public/brand/awards/mark.svg` is fine.
- Film: keep `FilmLightbox` behind a "Watch the film" text button with the poster only; no `LoopVideo`.
- Delete `DemoMount` usage, `HeroDemo`, `DemoPhone`, `LoopVideo` from the landing. Nothing on `/`
  may import `LiteApp`, `DemoProvider`, or the `lite/` screens.

## Motion rules

`useReveal()` (IntersectionObserver, once, threshold 0.2) adds `.is-in`; CSS transitions on
`opacity`/`transform` only, 600–700ms `--s-ease-expo`, stagger 60ms. Count-up runs once when the
proof wall enters. Feed tick: every 6s, new row translates in from the top, old fades out. Guarantee
line: `stroke-dashoffset` driven by a scroll progress in JS (rAF, passive). `prefers-reduced-motion`:
everything visible immediately, no transitions, feed rows swap without motion.

## Data (real only)

Proof wall reads `/api/vera-record?chain=mantle` (public, no auth) → `record.totalRecommendations`,
`record.totalExecutedUsd`, `record.recentRecommendations[]`, `reputation`. When Base is deployed,
also read `?chain=base` and show a chain tab. If the list is empty, show the mechanism steps in the
panel instead. Never fabricate a row, a number, or a testimonial.

## Files and ownership (three parallel agents)

CSS: CSS Modules only (`*.module.css` next to each section) using the `--s-*` tokens from
`globals.css`; do not add to `globals.css` except to remove dead `.site` rules you replaced.

| Agent | Owns |
|---|---|
| landing-hero | `site/SiteLanding.tsx` (composition + nav + imports of every section), `site/sections/Hero.tsx`, `Hero.module.css`, `ProofWall.tsx`, `ProofWall.module.css`, `Awards.tsx`, `Awards.module.css`, `site/motion.ts`, `site/Nav.tsx` + css, `public/brand/awards/*`, removal of `LoopVideo.tsx` + `DemoMount` usage from the site |
| landing-story | `site/sections/HowItWorks.tsx`, `Guarantee.tsx`, `Baskets.tsx`, `Assets.tsx` (+ module css each), `site/PhoneChrome.tsx`, `public/brand/screens/*` |
| landing-close | `site/sections/BuiltOn.tsx`, `Faq.tsx`, `Closing.tsx` (+ module css), `public/llms.txt`, `src/lib/seo.ts` + `app/layout.tsx` metadata description (awards), `app/page.tsx` if needed |

Exports (fixed names so the shell compiles once everyone is done):
`export function Hero()`, `ProofWall()`, `Awards()`, `HowItWorks()`, `Guarantee()`, `Baskets()`,
`Assets()`, `BuiltOn()`, `Faq()`, `Closing()`, `Nav()`; all client components where they use hooks;
all accept no props (read from the registry / libs themselves). `site/motion.ts` exports
`useReveal(): { ref, className }`, `useCountUp(target, {duration})`, `usePrefersReducedMotion()`.
Until every file exists the shell will not type-check; that is expected, the lead integrates.

## Addendum (user direction, 2026-09-06): minimal, no slop

- **Word budgets, hard:** Hero ≤ 30 words total (H1 ≤ 8, sub ≤ 16, kicker ≤ 8). Every other
  section: one heading ≤ 6 words, at most one line ≤ 16 words, then the thing itself (screenshot,
  diagram, record, baskets). Awards: name, date, one quote, link — nothing else. FAQ: keep 5 items max.
- **No text-filled boxes.** No three-card feature grids, no icon + heading + paragraph tiles, no
  "why us" bullet lists, no testimonials. If a section is only words, cut it or fold it into one line.
- **No mock data anywhere.** Proof wall shows real chain records or its honest empty state; baskets
  show real weights; screenshots are of the real app; numbers only from the API. Never invent
  users, returns, counts, or quotes.
- **Whitespace is the pattern.** Fewer, larger moments. Sections breathe (≥ 120px on desktop).
  Assets marquee becomes a single quiet row of logos, no captions. BuiltOn collapses into one line
  of marks above the footer. Guarantee keeps the diagram, drops the paragraph.
- **Motion is one gesture per section**, not decoration.
