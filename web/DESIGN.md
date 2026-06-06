# Design

Visual system for Stax, captured from the live implementation (`src/app/globals.css`, the `.stax` scope). Theme name: **Soft** — friendly, rounded, gentle; a warm consumer-fintech surface, not a crypto dashboard. Light is default; dark is first-class. All app styling is scoped under `.stax` and toggled with `[data-mode="light|dark"]`.

## Theme

Soft, calm, tactile. Rounded geometry (radii 10–32px), generous shadows that read as soft elevation rather than hard cards, a warm sage-green primary, and an editorial serif reserved for display moments. The feeling target sits between Cash App's consumer clarity, Monzo's human warmth, and Linear/Stripe's craft and restraint. Mobile-first inside a centered iOS device frame on desktop (`.ios-frame`, 402px).

## Color

OKLCH-spirit warm-neutral surfaces with a single sage-green brand color carrying primary actions and a muted terracotta accent for trust/secondary signals. Restrained strategy: green and accent are for action and state, never decoration.

### Light (default)
- `--paper` `#eef1e8` — app background base; `--app-bg` is a soft radial wash `#f4f6ee → #e8ede0 → #dfe5d6`
- `--surface` `#ffffff`, `--surface-grad` `#ffffff → #fbfcf8`, `--surface-2` `#f2f5ee` (recessed)
- Ink ramp: `--ink` `#2b322c` (body/headings), `--ink-2` `#6a7268` (secondary), `--ink-3` `#a6ad9f` (quiet metadata)
- Lines: `--line` `#e6eae0`, `--line-2` `#eef2e9`
- Primary (sage): `--primary` `#57a07e`, `--primary-soft` `#e7f3ec`, `--primary-ink` `#ffffff`; `--hero-grad` `#6cb38f → #57a07e → #4b956f`
- Accent (terracotta, trust/on-chain): `--accent` `#e3a06f`, `--accent-soft` `#fbeede`
- Semantic: `--pos` `#57a07e`, `--neg` `#d97e5f`

### Dark
- `--paper` `#15191a`, `--app-bg` radial `#20262a → #12161a → #0c0f12`
- `--surface` `#1f2427`, `--surface-2` `#282f33`
- Ink: `--ink` `#eef2f0`, `--ink-2` `#a6aeac`, `--ink-3` `#6f7876`; lines `#303840` / `#282f33`
- Primary lifts for contrast: `--primary` `#6cc09c`, `--primary-soft` `#1e2c25`, `--primary-ink` `#0f1413`
- Accent `#ecab7e`; `--pos` `#6cc09c`, `--neg` `#ec8d6c`

### Contrast watch (a11y refine targets)
- `--ink-3` on `--surface-2` is the thinnest pairing — used for captions/metadata; verify ≥ 4.5:1 and lean toward `--ink-2` for anything users must read.
- Accent terracotta text on `--accent-soft` must clear the bar; prefer accent for icons/borders and `--ink` for the words.

## Typography

Three families, used by role (display + UI + mono — within the cap of 3). Loaded via `next/font/google` in `app/layout.tsx`, exposed as `--font-fraunces` / `--font-hanken` / `--font-jetbrains`, consumed through the semantic `--font-display` / `--font-ui` / `--font-mono`.
- **Display:** Fraunces (`--font-display`), a warm old-style serif with optical sizing (`font-optical-sizing: auto` on `.serif`/`.display*`), weight 400. Editorial moments only: hero balance, screen titles, success. Never on labels, buttons, or data.
- **UI/body:** Hanken Grotesk (`--font-ui`), a clean humanist sans, weights 400–800. Carries all interface text.
- **Mono:** JetBrains Mono (`--font-mono`), tabular. Trust/data surfaces: addresses, receipts, on-chain record lines.

Scale (fixed rem/px, not fluid — product register): `.display-xl` clamp(44–56px)/0.96, `.display` 34px, `.title` 27px/700, `.title-sm` 21px, `.heading` 18px/700, `.body` 15px/500 (`--ink-2`), `.body-sm` 13.5px (`--ink-3`), `.caption` 12.5px/600. Numerals use `.tnum` (tabular). Optical rule: larger type → tighter tracking and leading.

> Note: `.label-eyebrow` (11.5px uppercase, 0.14em tracking) currently appears as a section kicker in several screens. Per the product register, an uppercase tracked eyebrow above *every* section is an AI tell — keep it for genuine field labels (card stat labels), not as a repeated section header.

## Iconography

Lucide (`lucide-react`), via the `Icon` component (consistent stroke widths ~1.8–2.4). One icon family throughout. Brand marks (`VeraOrb`, `StaxMark`, `AssetTile`) live in `components/design/Brand.tsx`; asset tiles cover-fill real company/fund logos (Backed metadata) over a brand-colored fallback.

## Spacing & Layout

- Radii: `--r-sm` 10 / `--r` 16 / `--r-lg` 22 / `--r-xl` 30 / pill 999; component radii `--rr` 24, `--rr-lg` 32.
- Screen padding: horizontal 22–26px; `.screen-pad-top` 58px (clears the frosted status bar). Vertical rhythm runs in ~16–20px section steps — vary it deliberately rather than a flat 16 everywhere.
- Layout is a single scrolling column inside `.screen` (absolute-inset flex column, `overflow-y:auto`). Pinned action bars use `position: sticky; bottom: 0; margin-top: auto` with a `linear-gradient(to top, paper, … , transparent)` fade — NOT `position: absolute` (which scrolls inside the overflow container).
- Elevation: soft two-layer shadows (`--shadow`, `--shadow-lg`) instead of borders for cards.

## Material — Liquid Glass

The surface language is **liquid glass** (iOS-26 inspired, translated to CSS). An **aurora backdrop** (`--app-bg`: soft sage + terracotta radial blobs over the paper/dark base) gives the glass color to refract. Core surfaces — `.card`, `.field`, `.chip`, `.btn-ghost`/`.btn-outline`, the TabBar, and the BottomSheet — use a translucent material: `background: var(--glass)` + `backdrop-filter: var(--glass-blur)` (saturate 180–185% + blur 22px) + a specular edge (`--glass-hi` inset top highlight + `--glass-stroke` hairline border) + `--glass-shadow` for float. Tokens are themed per mode (`--glass`, `--glass-2`, `--glass-stroke`, `--glass-hi`, `--glass-blur`, `--glass-shadow`). Primary CTAs stay **solid** (`--hero-grad`) with a glass sheen so they keep contrast and dominance; small recessed bits (icon squares) stay `--surface-2`. Text stays solid ink for AA contrast (the one hard rule glass must not break).

## Components

Atoms (all under `.stax`): `.btn` (+`.btn-primary` hero-grad, `.btn-ghost`, `.btn-outline`, `.btn-lg`, `.btn-block`), `.card`, `.chip` (+`.is-on`), `.tile`, `.field` (focus-within ring in primary), `.seg` + `.seg-thumb` + `.seg-item` (sliding-thumb segmented control), `.row` (full-width press target), `.verified` (mono on-chain trust badge). Press feedback: `.tap` → `scale(0.97)` on `:active`; FAB uses `.tab-fab`.

State coverage to hold to (product register): every interactive element needs default / hover (gated to `hover:hover` pointers) / focus-visible / active / disabled / loading. Loading uses `.skeleton` shimmer for content, `Spinner` only for actions. Empty states should teach the next step (e.g. holdings empty → "Tell Vera a goal"), never just "nothing here."

## Motion

Emil-Kowalski easing, transform/opacity/filter only. `--ease-out` `cubic-bezier(.23,1,.32,1)` for entrances + UI feedback; `--ease-in-out` for on-screen morphs; `--ease-drawer` for iOS-like sheets; `--ease-soft` for gentle press overshoot. Durations 150–250ms for UI; entrances ~0.42s. Patterns: `.anim-rise`, `.stagger-in` (50ms apart), blur-mask `Crossfade` (`.xfade-layer`, swap two states as one morphing object), draw-in success check, confetti burst on success only. Entrances are transform-only so content stays visible if the clock never advances. Full `prefers-reduced-motion: reduce` branch drops animation to near-instant. No bounce/elastic, no page-load choreography on task screens.

## Chrome

`.stax-backdrop` (page backdrop) → `IOSFrame` (frosted status bar, `backdrop-filter: blur(16px)`, translucent paper/dark) → `.stax[data-mode]` content → `ToastProvider`. Desktop ≥520px renders the centered device with bezel, dynamic island, and home indicator.
