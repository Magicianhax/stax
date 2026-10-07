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

- Screenshots: capture from `/demo?mode=light&market=open` at 390×844, deviceScaleFactor 2, into
  `web/public/brand/screens/{goal,plan,market}.png` (PNG, keep each ≤ 350 KB; palette-reduce with
  sharp). The demo runs on BNB Chain (see docs/DEMO.md). Capture in the America/New_York time zone
  with `.stax .screen-pad-top { padding-top: 52px }` injected (the status bar PhoneChrome draws
  needs that room) and the Next dev badge hidden. `goal.png` is the one taken with
  `?market=closed`: Vera's refusal. The rest use `?market=open`, so the words never depend on the
  hour of the capture.
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

## Iteration 2 (user review, 2026-09-06): balance, alignment, motion, real logos

What the user saw and wants fixed, in their words: tweets unequal sizes; things not aligned,
scattered; the grid pattern is static, too dense, off-brand; hovering does nothing; "ugly divs" in
the hero (the proof-wall empty state); hero text feels old; integration logos should be real and on
ONE line. "We are building a professional brand, everything should be correctly placed."

### Layout law (every section, no exceptions)
- One container: `.wrap` = max-width 1200px, padding-inline 24px (16px < 480px), 12-column CSS grid
  with 24px gutters. Every section's content sits on those columns; headings start at column 1 and
  cards fill exact column spans (12 / 6+6 / 4+4+4 / 3×4). Nothing free-floats.
- One section header block: `h2` (Fraunces, clamp 36–56px, tight) + optional one-liner (≤16 words,
  `--s-ink-2`), 20px apart, 48px below to content. Same on every section.
- Vertical rhythm: 128px between sections on desktop, 88px mobile. Equal top/bottom.
- Equal cards: any row of cards uses `grid-auto-rows: 1fr`, identical padding (24px), identical
  radius (`--s-r-lg`), identical border/shadow. The two tweet cards MUST be the same height and width
  (6+6 columns, `align-items: stretch`, text clamped to the same number of lines with the full text
  on hover/focus title attribute). Same for basket cards and phone frames.
- Hairline alignment: section dividers and the nav hairline share the container edges.

### Motion + pattern (GSAP is installed: `gsap` + `@gsap/react` `useGSAP`; use the gsap-react skill patterns, never `motion`/framer)
- Background: replace the static ledger grid with a **sparse animated dot field** on the hero only:
  dots on a 48px lattice at 8% ink opacity, ~1 in 6 dots slowly breathes (opacity 0.08→0.22 over
  4–7s, random phase, GSAP timeline, paused under reduced motion), plus a very soft sage radial
  glow that follows the pointer with a 0.6s lag (GSAP quickTo on two CSS vars). Mask-fade at the
  edges. This is the brand's calm register; nothing strobes.
- Hover (desktop pointer only, `@media (hover:hover)`): cards lift 4px + shadow deepens + a 1px
  sage border glow fades in (180ms); buttons scale 1.02 with a soft shine sweep once; logos in the
  integration row go from `--s-ink-3` to full ink on hover; phone frames tilt ≤3° toward the
  pointer (GSAP quickTo rotateX/rotateY, spring back on leave); basket weight bars extend from 0
  on first reveal; the proof wall's stat numbers use a number-ticker on reveal.
- Reveal: one `useGSAP` batch per section (`gsap.from` y:24 opacity:0, stagger 0.06, expo.out,
  ScrollTrigger once). Keep content visible without JS.
- Library components to port (MIT, Magic UI / Aceternity style, into `src/components/site/ui/`):
  `DotField` (above), `BorderBeam` (a single beam travelling the proof-wall card's border),
  `NumberTicker`, `Marquee` (one line, pause on hover), `ShineButton`, `TiltCard`. Port the
  behaviour in GSAP/CSS; do not add new dependencies.

### Hero (rewrite copy, ≤30 words; the old copy is retired)
- Kicker: "Winner · Trading & Strategy  ·  Best UI/UX" with the two rosettes, "Mantle Turing Test
  Hackathon 2026" as a muted suffix.
- H1: "Say it. Own it." (Fraunces, clamp 56–96px).
- Sub: "Tell Vera your goal in plain words. She builds the plan, a contract checks it, and you own
  real shares in one tap."
- Buttons: "Open Stax" (ShineButton) · "Try the demo" (glass). Then "Watch the film" text link.
- Right column: **no boxed empty state.** The proof wall becomes ONE glass card with a BorderBeam:
  a header row (verified mark + "Signed, then verified on-chain"), three NumberTicker stats
  (Plans built / Invested / Checks passed) that show real numbers from the API and a thin "—" while
  loading or unavailable, and under them a single line of the latest record (risk %, amount,
  relative time, explorer link) or, when unavailable, a calm one-liner "Record loads from Mantle
  mainnet." No 3×2 verb grid, no stacked boxes.
- Mobile: H1 stack, buttons full width, the card below, everything on the same 24px gutter.

### Awards (equal, aligned)
- Heading "Two separate wins." + two identical 6+6 cards (award name row with rosette; the tweet
  card inside: avatar, Mantle / @Mantle_Official, X mark, text clamped to 5 lines, date). Both cards
  the same height; the whole card is the link; hover lift.

### Integrations (one line, real logos)
- Fetch official SVG logos: Coinbase and Chainlink from `https://cdn.simpleicons.org/coinbase` and
  `/chainlink`; Base and Mantle already exist; try official sources for Uniswap, Aave, Privy,
  Pimlico, Backed (their sites / GitHub brand assets). Normalize every mark to monochrome
  `currentColor`, 24px cap height, and store in `public/brand/partners/`. Where no official SVG can
  be fetched, use the name as a wordmark in Hanken 700 at the same height, never a drawn substitute.
- Render as ONE line: on desktop a single centered flex row (gap 40px, never wraps); on mobile the
  same row inside the `Marquee` (one line, slow, pause on hover). Sits above the footer, with a
  2-word kicker "Built on".

### Everything else
- Phones (HowItWorks): three frames on 4+4+4 columns, same size, same baseline; labels centered
  under each; TiltCard hover.
- Guarantee: diagram spans 12 columns; contract rows are a 12-column table with aligned mono
  columns.
- Baskets: 3×4 columns, equal heights, weight bars animate on reveal, hover lift.
- Assets: one Marquee line of logos, 56px, pause on hover, no captions.
- FAQ: 12 columns, heading 5 cols + list 7 cols, aligned to the same container.
- Closing + footer: footer columns on the grid; links baseline-aligned.
