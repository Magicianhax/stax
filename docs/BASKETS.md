# Baskets ("Stax") — spec

A basket is a named list of weights over the active chain's investable assets. It is the
product form of Base's "personalized index" category: one tap invests, Vera still signs the
risk inference, the executor still verifies it, and the recommendation hash already committed
on-chain (`recHash` = keccak of the allocation JSON) makes any basket's track record provable.

No new infra in v1: curated baskets live in code, personal baskets in `localStorage`, shared
baskets travel inside the link. Moving them to Postgres is on the infra todo.

## Types — `web/src/lib/baskets.ts`

```ts
export interface BasketItem { symbol: string; weightPct: number; reason?: string }
export interface Basket {
  id: string;                 // curated: "base:big-tech"; personal: nanoid-ish; shared: hash of contents
  chain: ChainKey;
  name: string;               // ≤ 28 chars, plain words ("Big Tech", "AI & Chips")
  tagline: string;            // one line, no jargon
  emoji: string;              // tile glyph
  color: string;              // hex accent for the tile
  items: BasketItem[];        // weights sum to 100 (±0.5); only routable symbols
  riskScore: number;          // bps, computed by riskScoreFor() — never trusted from a link
  author: "stax" | "vera" | "you" | "shared";
  createdAt: number;          // unix seconds
  source?: { goal?: string }; // when saved from a Vera plan
}
```

Helpers (all pure, all chain-aware):
- `CURATED_BASKETS: Record<ChainKey, Basket[]>` — Base: **Big Tech** (AAPL/GOOGL/META/NVDA), **AI & Chips** (NVDA/GOOGL/META), **Coinbase Ecosystem** (COIN when liquid, else CRCL-less fallback: NVDA/GOOGL + BTC/ETH), **Safe Growth** (aUSDC 40 + AAPL/GOOGL/NVDA), **Frontier** (SPCX/NVDA/BTC), **Bitcoin & Blue Chips** (BTC 35 / AAPL / NVDA / GOOGL). Mantle: Big Tech, Broad Market (SPY/QQQ), Safe Growth (mETH? no — Mantle has no safe dollar; use SPY-heavy), Crypto Blue Chips (mETH + stocks). Only include symbols where `isRoutable(chain, symbol)`; a curated basket whose symbols are not all routable is filtered at read time (never shown broken).
- `riskScoreFor(chain, items)` — blended bps by tier: safe 1000, fund (SPY/QQQ) 3500, stock 6000, crypto 8000, weighted by weightPct. Used client-side for display AND server-side in `/api/invest-plan` (take `max(client riskScore, riskScoreFor(...))` so a link can't understate risk).
- `basketToAllocation(basket)` → `Allocation` (`summary` = name, `rationale` = tagline, `riskScore`, `allocations` = items with `reason` defaulting to the display description's first sentence).
- `allocationToBasket(chain, allocation, name, goal)` — "Save as basket" from a Vera plan.
- `encodeBasketLink(basket)` / `decodeBasketLink(param)` — base64url of `{v:1,c,n,t,e,i:[[sym,pct],…]}`; decode validates symbols against the chain registry, renormalizes weights, recomputes risk, sets `author: "shared"`. Link form: `/app?basket=<param>` (and the landing accepts the same param and forwards to `/app`).
- `normalizeWeights(items)` — drop ≤0, renormalize to 100, last item absorbs rounding.

## Storage — `web/src/hooks/useBaskets.ts`

`useBaskets()` → `{ curated, mine, all, save(basket), remove(id), byId(id) }`. Personal baskets in
`localStorage["stax.baskets.<chainKey>"]`, external-store pattern like `lib/chains/active.ts`
(so every screen re-renders on save). Demo mode: `mine` seeded with one basket ("My first Stax").

## Performance — `web/src/hooks/useBasketPerformance.ts`

Compute from what exists: `/api/market` day summary (`dayChangePct`, `spark`) and the history
endpoint per symbol (`getHistory(chain, symbol, range)` behind `/api/market?symbol=&range=` —
check the route's actual query contract). Basket return over a range = Σ weight × symbol return.
Show 1D, 1W, 1M chips; "since you saved it" for personal baskets uses `createdAt` against the
history series (nearest point). Cache with react-query keyed by `[chain.key, basket.id, range]`.
Never show a number you cannot compute: fall back to "Not enough history yet".

## Screens (Operate mode, incumbent design system)

- **BasketsScreen** (`screens/BasketsScreen.tsx`) — header "Baskets", subline "Ready-made mixes
  you can invest in with one tap." Sections: *Yours* (empty state: "Save a plan from Vera or
  share a link to see it here"), *Made by Stax*. Tile: emoji on colored disc, name, tagline,
  mini stacked weight bar (asset colors from `displayFor`), 1M return chip, risk word.
- **BasketDetailScreen** (`screens/BasketDetailScreen.tsx`) — name, tagline, risk meter (reuse
  Plan's `riskMeta`), holdings list (logo, name, %, one-line why), performance chips + sparkline
  (reuse `Charts`), actions: **Invest** (amount sheet → `PlanScreen` with `basketToAllocation`,
  so the user still sees Vera's review and the same one-tap place), **Share** (copies link,
  toast "Link copied"; Web Share API on mobile), **Save** for shared baskets, **Remove** for yours.
  Below the fold: "How this is built" (weights are fixed; Vera signs the risk before each invest).
- **PlanScreen** — add a quiet "Save as basket" text action (name sheet, default = Vera's
  summary) after a successful plan; and "Share this plan" (same link format).
- **HomeScreen** — a horizontal "Baskets" rail under the Vera card (3–4 tiles + "See all").
- **LiteApp** — routes `baskets`, `basket` (params `{ id }` or `{ basket }` decoded from the
  link), TabBar: replace nothing; Baskets reachable from Home rail + Market header action.
  `/app?basket=` on load → decode → open BasketDetail with `author: "shared"`.
- Copy voice per `web/PRODUCT.md`: warm, plain, honest about risk ("stocks can go down too").

## Server hardening — `web/src/app/api/invest-plan/route.ts`

`assessedRisk = max(allocation.riskScore, riskScoreFor(chain, allocation.allocations))`, clamp
to ceiling. Reject allocations containing non-routable symbols with a 400 that names them.
