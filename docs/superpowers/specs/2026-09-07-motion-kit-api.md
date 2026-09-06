# Motion kit API — `@/components/motion` (2026-09-07)

One shared kit for the Stax app. Screens import from `@/components/motion`; nothing else adds
ad-hoc keyframes. Every piece honours `prefers-reduced-motion` (opacity only, no transforms;
`Burst` renders nothing). Files: `web/src/components/motion/*` (each file's header comment is
the authoritative prop doc).

## Components

| Export | Props | Usage |
|---|---|---|
| `Reveal` | `as="div"`, `delay=0` (s), `stagger=0.04` (s), `once?: string`, `className`, `style` | `<Reveal delay={0.1}>{rows}</Reveal>` — direct children rise 10 px + fade, 0.42 s `--ease-out`. Replays on remount / React `key` change. `once="home-list"` plays only the first time that key mounts in the session (no replay on tab return). |
| `Money` | `value`, `prev?`, `currency="USD"`, `dp=2`, `compact?`, `size?` (font px), `className`, `style` | `<Money value={cash} size={34} />` — tabular numerals. First paint is static unless `prev` is given (`<Money value={140.55} prev={240.55} />` counts on mount). Later `value` changes count 0.6 s from the last shown value and flash `--pos`/`--neg` 0.9 s. |
| `Tick` | `value`, `format?=(v)=>"$x.xx"`, `className`, `style` | `<Tick value={price} />` — live price cell; on change: 0.7 s wash (`--primary-soft` up / terracotta 18 % down) + digit crossfade. |
| `DrawCheck` | `size=56`, `delay=0` (s), `tone="primary"\|"accent"`, `className`, `style` | `<DrawCheck size={64} delay={0.2} />` — disc pops (`--ease-soft`), check draws 0.5 s. One per screen. |
| `Burst` | `fire=true`, `count=26` | `<Burst fire={done} />` inside a `position: relative` parent — one shot per false→true edge, brand palette, 900 ms. `Confetti` from `@/components/design` is an alias. |
| `HoldButton` | `onComplete`, `ms=900`, `disabled`, `block=true`, `hint="Keep holding…"`, `className`, `style`, `children` | `<HoldButton onComplete={place}>Hold to buy</HoldButton>` — `.btn.btn-primary` with an SVG ring beside the label that fills while held; early release snaps back; completion fires `haptic.success()` then `onComplete` once. |
| `SheetStep` | `step: string`, `dir="fwd"\|"back"`, `className`, `style` | `<SheetStep step={step} dir={dir}>{content}</SheetStep>` — remounts on `step` change; slides 10 px from the right (fwd) or left (back) with a fade, 0.26 s. Used by `ReceiveSheet`, `AnyNetwork`, `FromWallet`. |

## Hooks

| Export | Signature | Usage |
|---|---|---|
| `useHoldPress` | `({ ms=900, onComplete, disabled }) → { bind, progress, holding }` | `<button {...bind}>` — pointer + keyboard (Space/Enter held). `progress` 0..1 via rAF for a custom ring. |
| `useFlashRow` | `(key: string \| undefined) → { ref, className }` | `<div ref={ref} className={className}>` — one-time 1.2 s `--primary-soft` wash when the element enters view; each key fires once per session (key it `${symbol}:${txHash}`). |
| `useMoneyDelta` | `(value, holdMs=400) → "up" \| "down" \| null` | Direction of the last change, for a custom flash. |
| `formatMoney` | `(v, currency="USD", dp=2, compact=false) → string` | Same formatter `Money` uses. |
| `reducedMotion` | `() → boolean` | Client-side `prefers-reduced-motion` check. |

## Design primitives touched (import from `@/components/design`)

- **`BottomSheet`** `{ open, onClose, title?, label?, children }` — now `role="dialog"`,
  `aria-modal`, labelled by `title` (or `label` when the sheet has its own header). Focus moves to
  the panel on open and returns to the opener on close; Escape closes; spring enter (`sheetUp`,
  0.42 s `--ease-drawer`, 1.5 % overshoot), 0.22 s exit; drag-dismiss unchanged.
- **`HoldingRow`** `{ asset, symbol?, qty?, sub?, value?, change?, right?, onClick?, dim?, showSpark=true, flashKey?, size=44 }`
  — one anatomy: `AssetTile 44` · name · sub (default `"{qty} {symbol}"`) · right column `value` +
  `change`. `change: { pct?, abs?, label? }` renders `"+$12.40 +2.41% today"` coloured pos/neg
  (label alone renders muted). `right` replaces the whole right column. `flashKey` wires
  `useFlashRow`. Example: `<HoldingRow asset={toTile("NVDA")} qty="0.4303" symbol="NVDA" value="$99.75" change={{ pct: 2.41, label: "today" }} flashKey={`NVDA:${tx}`} onClick={…} />`
- **`LogoCluster`** `{ assets: { symbol, name? }[], size=24, max=4, ring="var(--surface)" }` —
  overlapping `AssetTile`s with a 2 px ring and a "+N" disc; resolves display via `toTile`.
  `<LogoCluster assets={plan.holdings.map(h => ({ symbol: h.symbol }))} />`
- **`PriceChart`** `{ data?: number[], points?: { t: number | string; v: number }[], up, area=true, height=210, ranges?, range?, onRange?, label, onScrub?(point | null), formatValue?, formatTime? }`
  — scrub (pointer/touch) shows a crosshair, dot and a price (+ date when `points` given) pill
  clamped inside the chart; min/max labels at the extremes; when the data changes the path morphs
  (GSAP `attr` on `d`, 0.5 s); line colour follows `up`; `area` draws the gradient fill (line
  colour 22 % → 0). Pass `ranges` + `range` + `onRange` together to render `RangeChips` under the
  chart. `t` is a ms timestamp (seconds also accepted) or a ready label. `onScrub` receives
  `{ t, v, index }` or `null`.
  `<PriceChart points={portfolioSeries(r)} up ranges={RANGES} range={r} onRange={setR} onScrub={setHover} />`

## Charts (import from `@/components/design`; demo inputs from `@/lib/demoSeries`)

| Export | Props | Usage |
|---|---|---|
| `RangeChips` | `values: readonly string[]`, `value`, `onChange(value)`, `size=32`, `className`, `style` | `<RangeChips values={["1D","1W","1M","1Y","All"]} value={r} onChange={setR} />` — the one segmented range picker (`.seg` pill track, sliding thumb, radiogroup with arrow/Home/End keys). PriceChart renders it for you via `ranges/range/onRange`. |
| `Bars` | `data: { label; value; tone?: "pos"\|"neg"\|"neutral" }[]`, `height=120`, `showValues`, `formatValue` (default signed `+$120`), `label` | `<Bars data={weeks} height={110} />` — bars grow from the baseline on mount (30 ms stagger); tone follows the sign unless set; tap a bar to read `label · value` above the chart (aria-live). Mixed signs put the baseline mid-chart. |
| `ProjectionChart` | `contributed: {t,v}[]`, `projected: {t,v}[]`, `height=150`, `formatValue` (default `$1,340`), `label` | `<ProjectionChart {...projection({ amount, cadence, riskBps, months: 12 })} />` — projected value as a primary area + line, contributions as a dashed line, legend with both end values, a scale cue at the top; paths morph 0.5 s when inputs change. |
| `Sparkline` | existing `data, w, h, color, strong` + `fill` | `<Sparkline data={vals} w={120} h={60} fill />` — `fill` adds the soft area; the line now draws on mount (0.7 s) with the area fading in. |

### `lib/demoSeries.ts` — deterministic demo inputs (stable screenshots)

| Export | Returns | Notes |
|---|---|---|
| `DEMO_NOW` | ms | Fixed anchor: Mon 7 Sep 2026 14:00 UTC. All timestamps count back from it. |
| `priceSeries(symbol, range)` | `{ t, v }[]` | Seeded walk per symbol+range, ends at the display price; change scales with the asset's `day` like `demoHistory`. 1D 48 pts / 1W 56 / 1M 30 / 1Y 52 / All 60. |
| `portfolioSeries(range, end = 2752.55)` | `{ t, v }[]` | Portfolio value ending at the demo total (pass the real total when known). |
| `cashFlowWeeks(n = 8)` | `{ t, v }[]` | Net cash per week, deposits `+`, cash-outs `−`, oldest first. Map to `Bars` with `label: short date`. |
| `projection({ amount, cadence, riskBps, months })` | `{ contributed, projected }` | Monthly points from today; assumed annual return 2 % + risk/10000 × 10 %. Reading line: `≈ ${projected.at(-1).v} in ${months} months at $${amount}/${cadence}`. |

## Globals

- `.nav-fade` (tab roots) is now a crossfade + 8 px rise over 0.26 s.
- `sheetUp` keyframe = the sheet spring; applied by `.sheet-panel[data-open="true"]`.
- Removed: `floatY`, `confettiBurst` keyframes; `.step`/`.stepBack` from `receive.module.css`.
  Still present because they have users: `rise-fade` (`.stagger-in`, used by Home/Owned/Wallet/
  Vera/Activity/Success lists) and `sheenSweep` (`.sheen-sweep` on the Home Vera card).
