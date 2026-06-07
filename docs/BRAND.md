# Stax — Brand Guidelines

> Investing in plain words. Real companies, real shares, an assistant whose record you can verify.

This is the single source of truth for how Stax looks and sounds. Values here are taken
directly from the live design tokens in `web/src/app/globals.css` — keep the two in sync.

---

## 1. Essence

**What Stax is:** a mobile-first app where anyone can buy real, tokenized stocks ("xStocks")
in plain words, guided by an on-chain AI assistant, **Vera**. From $1, gas-free, settled
on Mantle, with every recommendation signed and recorded on-chain.

**One-liner:** Invest in plain words.

**Promise:** No jargon, no seed phrases, no surprise fees. Tell Vera a goal, review the plan,
invest in one tap.

**Personality:** Calm, warm, trustworthy, plain-spoken. A knowledgeable friend, not a trading
terminal. Confident without hype.

---

## 2. Names & spelling

| Term | Use | Never |
|------|-----|-------|
| **Stax** | The product. Always capital S, rest lowercase. | "STAX", "stax" mid-sentence, "Stacks" |
| **Vera** | The AI assistant. Always "Vera", never "the AI" or "the bot" in UI copy. | "VERA", "Vera AI" |
| **xStocks** | Tokenized stocks (lowercase x). | "X-Stocks", "Xstocks" |
| **Mantle** | The network we settle on. Always paired with its logo where space allows. | "mantle" |
| **Backed** | The regulated issuer that tokenizes the real shares. | — |

Social handle: **@stax_market** (X). Site: **stax.best** (canonical: `www.stax.best`).

---

## 3. Voice & tone

**We sound like a person explaining money to a friend.**

Principles:
- **Plain words first.** "Real companies you know," not "diversified equity exposure."
- **Short, calm sentences.** Lead with the benefit, then the detail.
- **Honest about risk.** Never imply guaranteed returns. Always pair upside with the caveat.
- **Specific, not salesy.** "From $1, gas-free" beats "revolutionary, seamless, next-gen."

Hard rules:
- **No em dashes.** Use a comma, a period, or "and". (This is a brand tell — em dashes read as AI slop.)
- **No AI slop.** Avoid "seamless," "unlock," "supercharge," "revolutionary," "elevate,"
  "in today's fast-paced world," empty superlatives, and mono-spaced "trust pills."
- **No jargon on the surface.** Tickers, bps, slippage, custody — explain or hide them.
- **Mono font is for data only** (addresses, hashes, tx ids). Never for labels or headings.

Compliance line (use near any returns/figures): **"Not investment advice. Capital at risk."**
Plus: "Stocks can go down as well as up, only invest what you can leave for a while."

Sample voice:
- ✅ "Tell Vera a goal in plain words, like 'grow $300, mostly big tech, keep some safe.'"
- ✅ "We cover every network fee. One small fee on what you invest, nothing hidden."
- ❌ "Unlock seamless, next-gen exposure to a revolutionary tokenized asset class."

---

## 4. Logo

- **App mark:** `web/public/brand/stax-light.png` (the light mark is used in **both** themes, per brand).
- Keep clear space around the mark equal to at least the height of the "S".
- Wordmark "Stax" is set in the display serif (Fraunces).
- Don't recolor, stretch, add shadows/outlines, or place the mark on a busy/low-contrast background.
- Partner logos (`web/public/brand/partners/`): Mantle, Backed — use as provided, don't restyle.

---

## 5. Color

Stax has two themed scopes that share one identity: the **app** (`.stax`) and the
**marketing site** (`.site`). Both are sage-led, paper-neutral, with light + dark modes.

### Core identity
| Role | Light | Dark |
|------|-------|------|
| **Primary (sage)** | `#57a07e` | `#6cc09c` |
| **Primary strong** | `#4b956f` | `#57a07e` |
| **Accent (teal)** | `#3f8f86` | `#5cc0b2` |
| **Paper (site bg)** | `#eef1e8` | `#11150f` |
| **Positive** | `#57a07e` | `#6cc09c` |
| **Negative** | `#c0492f` | `#ef8f7e` |

### App scope (`.stax`) — light / dark
| Token | Light | Dark |
|-------|-------|------|
| `--surface` | `#ffffff` | `#1f2427` |
| `--surface-2` | `#f2f5ee` | `#282f33` |
| `--ink` (text) | `#232a25` | `#eef2f0` |
| `--ink-2` (secondary) | `#545d52` | `#aeb6b3` |
| `--ink-3` (quiet) | `#6e7768` | `#8a938f` |
| `--line` | `#e6eae0` | `#303840` |
| `--primary` | `#57a07e` | `#6cc09c` |
| `--accent` | `#3f8f86` | `#5cc0b2` |

### Site scope (`.site`) — light / dark
| Token | Light | Dark |
|-------|-------|------|
| `--s-paper` | `#eef1e8` | `#11150f` |
| `--s-surface` | `#ffffff` | `#1b2018` |
| `--s-ink` | `#232a24` | `#eef2ea` |
| `--s-ink-2` | `#545d52` | `#a8b0a2` |
| `--s-primary` | `#57a07e` | `#6cc09c` |

### Gradients
- **Hero / primary fill (`--hero-grad`):** `linear-gradient(145deg, #6cb38f 0%, #57a07e 52%, #4b956f 100%)`
- **Site hero (`--s-hero-grad`):** `linear-gradient(135deg, #6cb38f 0%, #4f9e7c 48%, #3f8765 100%)`

### Rules
- **Sage is the brand.** Lead with it. Teal is the supporting accent (links, highlights, secondary CTAs).
- **Avoid yellow / gold accents.** A warmer accent was used early on and has been retired — keep
  surfaces sage + neutral, accents teal. No yellowish tints anywhere.
- Neutrals are **warm paper**, never pure cold grey.
- Maintain AA contrast: body text uses `--ink`/`--ink-2`; `--ink-3` is for quiet metadata only.

---

## 6. Typography

Three families, self-hosted via `next/font` (subsetted, `display: swap`):

| Role | Family | Token | Use |
|------|--------|-------|-----|
| **Display** | Fraunces (warm old-style serif, optical) | `--font-display` | Headlines, hero, the "Stax" wordmark. Can be italic for emphasis. |
| **UI** | Hanken Grotesk (clean humanist sans) | `--font-ui` | All interface text, body, labels, buttons. |
| **Data** | JetBrains Mono | `--font-mono` | Addresses, hashes, tx ids, prices in receipts. **Data only.** |

Rules:
- Headlines: Fraunces, generous size, tight-ish leading, warm and human.
- Body: Hanken, comfortable size, never tiny.
- **Mono is the slop tell when misused** — never set labels, headings, or marketing copy in mono.

---

## 7. UI material & shape

The Stax surface language is **soft glass** (glassmorphism) on warm paper.

- **Glass:** translucent panels with blur + saturation. App: `blur(22px) saturate(180-185%)`.
  Site: `blur(20px) saturate(190%)`. Subtle inner highlight (`--glass-hi`), soft shadow.
- **Radii:** rounded and friendly. App cards large radius; site `--s-r: 18px`, `--s-r-lg: 26px`, `--s-r-xl: 36px`.
- **Buttons:**
  - Primary = sage `--hero-grad` fill, white ink, soft shadow, a pointer-tracking specular sheen.
  - Glass = translucent `--glass` with stroke, for secondary actions.
- **Shadows:** soft, warm-tinted (greenish-grey), never hard black.
- **Motion:** gentle. Scroll reveals + count-ups use soft decel easing (`--s-ease-expo`).
  Respect `prefers-reduced-motion`. No aggressive bounces or spins.
- **Credential / verified states:** use the **Seal** component (sage hero-grad circle + check),
  not mono-text "trust pills."

---

## 8. Iconography & imagery

- **Icons:** `lucide-react`, stroke ~1.9–2.2. Consistent family across app and site.
- **Asset logos:** real brand logos for stocks/funds (via `displayFor`), with a colored-initial fallback.
- **Vera:** rendered as a soft, friendly presence (`brand/vera*.png`); when abstract, a gentle sage glow/orb.
- **Photography/illustration:** airy, lots of negative space, warm light, premium and calm. No stock-photo clichés, no neon "crypto" tropes, no candlestick-chart noise.

---

## 9. Taglines

Primary: **Invest in plain words.**

Approved alternates:
- Own the world's best companies.
- Real shares, in plain words.
- From a sentence to a real portfolio.
- Your first investment is one sentence away.

---

## 10. Quick do / don't

**Do**
- Lead with sage, keep it calm and warm.
- Explain money in plain words.
- Show real shares, real records, honest risk.
- Use Fraunces for display, Hanken for UI, mono for data only.

**Don't**
- Use em dashes, AI-slop superlatives, or jargon on the surface.
- Add yellow/gold accents or cold grey neutrals.
- Set labels/headings in mono or lean on "trust pills."
- Imply guaranteed returns. Always pair upside with "capital at risk."

---

_Last updated alongside the live tokens in `web/src/app/globals.css`. If you change a color or
font there, update this file in the same commit._
