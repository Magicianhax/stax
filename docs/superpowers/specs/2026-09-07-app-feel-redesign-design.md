# Stax app: feel redesign (2026-09-07)

Approved direction: keep the current design language (tokens, Fraunces + Hanken + JetBrains, liquid
glass, aurora, radii) and add feel: motion tied to state changes, logos wherever the app is blank,
distinct jobs per tab, and the small correctness fixes that erode trust. Source of truth for what is
wrong today: the audit at scratchpad `app-audit/AUDIT.md` (screens, tokens, top 10).

Scope: `web/src/components/lite/**`, `web/src/components/design/**`, `web/src/app/globals.css`, and
the demo driver in `LiteApp.tsx`. No new animation library: GSAP (already a dependency) plus CSS.
Everything honours `prefers-reduced-motion` (fade only, no transforms, no confetti).

## 1. Motion kit — `web/src/components/motion/`

One small, shared kit. Screens import from `@/components/motion`; nothing else adds ad-hoc keyframes.

| Piece | API | Behaviour |
|---|---|---|
| `Reveal` | `<Reveal as="div" delay stagger>{children}</Reveal>` | Children rise 10px + fade on mount, staggered 40 ms, `--ease-out`, 0.42 s. Replays only when `key` changes, not on tab return. Replaces raw `anim-rise` + `animationDelay` maths. |
| `Money` | `<Money value prev? currency="USD" size />` | Tabular numerals; counts from `prev` (or last rendered value) to `value` over 0.6 s; on change flashes text colour to `--pos` or `--neg` for 0.9 s then settles. Static on first paint (no count-up from 0 every visit). |
| `Tick` | `<Tick value format />` | Live price cell. On change: background wash `--primary-soft` / terracotta at 18% for 0.7 s, digits crossfade. |
| `Sheet` | existing `BottomSheet` gains `role="dialog" aria-modal`, spring open (`--ease-drawer`, 0.42 s, 1.5% overshoot), step container `SheetStep dir="fwd|back"` (moves Receive's step animation into the kit). |
| `DrawCheck` | `<DrawCheck size delay />` | Circle scales in with `--ease-soft`, check path draws 0.5 s (existing `drawCheck` keyframe). |
| `Burst` | `<Burst fire />` | Existing `Confetti`, exported from the kit, brand palette only (primary, accent, paper), 900 ms, one shot. |
| `useHoldPress` | `useHoldPress({ ms: 900, onComplete })` → `{ bind, progress }` | Pointer-down starts a ring fill; release before `ms` cancels with a soft snap-back; complete fires haptic.success + `onComplete`. |
| `useFlashRow` | `useFlashRow(key)` | After a trade, the affected `HoldingRow` gets a one-time `--primary-soft` wash (1.2 s) when it enters view. |

Tab roots: `nav-fade` becomes crossfade + 8 px rise over 0.26 s. Push/pop unchanged.

Unused keyframes (`floatY`, `sheenSweep`, `rise-fade`) are deleted.

## 2. Trade → Review → Placing → Receipt / Success

**TradeScreen**
- Header collapses to one line: `AssetTile 32` · name · price · change chip. Mini chart and the repeated
  closed banner go; the closed state becomes a 1-line eyebrow under the header ("Market closed · fills at
  the next open price").
- Amount block is the first thing on screen. Presets stay. Sell has no default amount; "All" is a chip.
- Slippage lives under an "Advanced" disclosure (closed by default), showing the current value inline.
- Fee line: "$0.25 fee · no network cost". Never "bps".
- Primary CTA reads "Review buy" / "Review sell" and opens the Review sheet.

**Review sheet (new `ReviewSheet.tsx`)**
- `AssetTile 44` + "Buy Nvidia", then rows: Shares (≈ 0.4303 NVDA), Price ($231.48), Fee ($0.25),
  Total ($100.00), Network (Base). Sell mirrors: Shares, Price, You receive.
- Hold-to-confirm button using `useHoldPress` (ring fills around the button label, 900 ms). Release
  early snaps back. Completion dismisses the sheet and pushes Placing.

**PlacingScreen**
- Keeps orb + checklist. Each step's check uses `DrawCheck`; the active step's label pulses once; the
  orb `pulse`s until done. Centring bug fixed (content is `margin: 0 auto; max-width: 100%`).
- Minimum dwell 1.2 s so it never flashes.

**ReceiptScreen**
- Hero: `AssetTile 64` with a `DrawCheck` badge overlapping its corner. Title "Bought Nvidia" /
  "Sold Nvidia" / "Sent USDC" / "Invested with Vera". Amount uses `Money` (counts once).
- Rows (each `Reveal`ed): Shares & price ("0.4303 NVDA @ $231.48"), Fee, Status, Paid from / Paid to
  (side-specific), Network, Time (exact, "Sep 7, 2026 · 14:02"). Sell shows "Added to cash: $99.75";
  the "Real shares, held by you" line appears only on buys.
- One check on screen: the Permanent record card uses the seal glyph, not a second check.
- Next actions row: "Buy more" / "View position" / "Share" (Web Share API, falls back to copy link).
- Close returns to the asset detail (manual trades) or Home (Vera). See §2 "Closing the loop".

**SuccessScreen** (Vera invest)
- Adds the consequence: "Cash $240.55 → $140.55" with `Money`, and "You now hold" list where new
  rows `useFlashRow`. Confetti via `Burst` stays.

**Closing the loop**
- After any trade or invest, the destination screen receives `{ flash: symbol[], prevCash, prevTotal }`
  through the nav stack: balance `Money` counts old→new, affected rows flash, and a toast fires
  ("Bought 0.4303 NVDA · $100"). Never lands on an empty Trade form.

## 3. Distinct jobs per tab, live charts

**Home** — balance with today's change chip and a 60 px sparkline under it; Vera card; basket rail as
logo clusters; compact holdings (top 4, "See all" → Owned); recent activity rows with logo clusters.
The header cluster is chain chip · activity (history icon, not a bell) · settings.

**Owned (PortfolioScreen)** — the performance screen. Range chips (1D 1W 1M 1Y All); total with the
range's P&L in `Money`; donut centre shows the total, not "4 held"; holdings with per-row gain for the
range; legend colours from a fixed brand ramp (primary, accent, ink-3, terracotta-soft) so the brand
green is never doubled.

**Wallet** — money movement only: balance + cash, Receive / Send / Cash-out (when Offramp is
configured), cash row, deposits (Relay history when any), transactions with dates. Holdings list removed.

**Charts (`PriceChart`)** — scrub with a crosshair and a price + date readout above the line; min and
max labels at the extremes; range change morphs the path (GSAP `attr` tween on `d`, 0.5 s); the line
colour follows the range's change (pos/neg). Used on Asset detail and Basket detail.

## 4. Brand everywhere

- One `HoldingRow` anatomy: `AssetTile 44`, name, sub-label (qty · symbol), right column value +
  change for the row's context. Used by Home, Owned, Plan, Success, Activity.
- `LogoCluster` (new, in design/): up to 4 overlapping `AssetTile 24` with a "+N" disc. Used on basket
  tiles and rail, Activity rows, Vera's recorded plans, Home recent activity.
- Receive: dropdown placeholder is a dashed-outline glyph, not a grey disc; "From another wallet" shows
  a row of wallet marks (MetaMask, Coinbase Wallet, Rainbow, WalletConnect as simple monochrome
  SVGs) and a three-step "what happens" list.
- Settings avatar is the Stax mark; Appearance row reflects the rendered mode.
- Light theme pass: card stroke `--line` at full opacity on aurora, receipt hero on `--surface`, Vera
  CTA weight reduced (gradient at 80%).

## 5. Trust fixes

- Demo data: position value = shares × price; Wallet transactions mirror Home activity; Activity rows
  carry dates and group by day.
- Copy: "Base network", "25 bps fee" → "$0.25 fee", sell receipt rows.
- `BottomSheet`: `role="dialog"`, `aria-modal`, labelled by its title, focus moves in and returns.
- Thinking: minimum dwell 1.2 s. Placing: centring fix.
- Autopilot: one CTA; a preview line "Next run Mon 9 Sep · $25 · Balanced"; fee in dollars.
- Trade sell: no default amount.

## Ownership (parallel agents after the kit is committed)

| agent | owns |
|---|---|
| `feel-kit` (first, sequential) | `components/motion/*`, `BottomSheet` dialog + spring, tab crossfade, keyframe cleanup, `LogoCluster`, `HoldingRow` unification, `PriceChart` scrub + morph |
| `feel-trade` | Trade, ReviewSheet, Placing, Receipt, Success, closing-the-loop plumbing in `LiteApp` |
| `feel-tabs` | Home, Owned, Wallet, Activity, Vera recorded plans, Baskets tiles/rail |
| `feel-brand` | Receive polish, Settings, light-theme pass, Send/Autopilot copy + CTA, Thinking dwell |

Each agent: tsc 0, eslint clean on owned files, screenshots light + dark at 390 px of every owned
screen, and a written note of anything unverified. Final: code review agent, then commit + push.
