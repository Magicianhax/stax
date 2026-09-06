// Baskets ("Stax") — named weight lists over the active chain's investable assets.
// See docs/BASKETS.md. Everything here is pure and chain-aware so the same
// helpers run in the browser (screens, links) and on the server (invest-plan
// hardening). No React, no storage — that lives in hooks/useBaskets.ts.
//
//   CURATED_BASKETS      — in code, per chain; filtered at read time so a basket
//                          whose symbols aren't all routable is never shown broken
//   riskScoreFor()       — blended bps by tier; the server re-derives it so a link
//                          can never understate risk
//   basketToAllocation() — the AllocateResult PlanScreen expects (one-tap invest)
//   sharedBasketFrom()   — one untrusted-input validator for links AND stored baskets
//   short ids            — 8-char `/app?b=<id>` links for server-stored baskets
//   encode/decodeBasketLink — base64url `{v:1,c,n,t,e,i:[[sym,pct],…]}`; decode
//                          trusts nothing: validates symbols, renormalizes, recomputes
import { getChain, isChainKey, isRoutable, type ChainKey, type StaxChain } from "@/lib/chains";
import { displayFor } from "@/lib/displayAssets";
import type { Allocation } from "@/lib/allocation-schema";
import type { AllocateResult } from "@/lib/invest-types";
import { absoluteAppUrl } from "@/lib/urls";

export interface BasketItem {
  symbol: string;
  weightPct: number;
  reason?: string;
}

export type BasketAuthor = "stax" | "vera" | "you" | "shared";

/** Tile glyphs are Lucide icons, never emoji. Names are validated on shared links. */
export const BASKET_ICONS = ["basket", "building", "cpu", "coins", "sprout", "rocket", "bitcoin", "layers", "globe", "gem", "sparkles"] as const;
export type BasketIcon = (typeof BASKET_ICONS)[number];

export interface Basket {
  id: string; // curated: "base:big-tech"; personal: "p_…"; shared: hash of contents
  chain: ChainKey;
  name: string; // ≤ 28 chars, plain words
  tagline: string; // one line, no jargon
  icon: BasketIcon; // tile glyph (Lucide icon name, see components/BasketIcon)
  color: string; // hex accent for the tile
  items: BasketItem[]; // weights sum to 100; only routable symbols
  riskScore: number; // bps, always from riskScoreFor()
  author: BasketAuthor;
  createdAt: number; // unix seconds
  source?: { goal?: string };
}

export const BASKET_NAME_MAX = 28;
export const BASKET_TAGLINE_MAX = 90;
export const BASKET_MAX_ITEMS = 12;

// ── risk ──────────────────────────────────────────────────────────────────────
// Blended bps by tier. Funds (SPY/QQQ) are stocks on-chain but broad in practice.
const TIER_BPS = { safe: 1000, fund: 3500, stock: 6000, crypto: 8000 } as const;

function tierBps(chain: StaxChain, symbol: string): number {
  const asset = chain.assets.all.find((a) => a.symbol === symbol);
  if (!asset) return TIER_BPS.stock;
  if (asset.tier === "safe") return TIER_BPS.safe;
  if (asset.tier === "crypto") return TIER_BPS.crypto;
  return displayFor(symbol, asset.name).kind === "fund" ? TIER_BPS.fund : TIER_BPS.stock;
}

/** Weighted risk in bps (0..10000) for a set of weights on `chain`. */
export function riskScoreFor(chain: StaxChain, items: { symbol: string; weightPct: number }[]): number {
  const total = items.reduce((s, i) => s + Math.max(0, i.weightPct), 0);
  if (total <= 0) return 0;
  const blended = items.reduce((s, i) => s + Math.max(0, i.weightPct) * tierBps(chain, i.symbol), 0) / total;
  return Math.max(0, Math.min(10000, Math.round(blended)));
}

/** Plain risk word for a bps score (matches PlanScreen's meter labels). */
export function riskWord(bps: number): string {
  const v = bps / 100;
  if (v < 20) return "Very steady";
  if (v < 40) return "Cautious";
  if (v < 60) return "Balanced";
  if (v < 80) return "Adventurous";
  return "Bold";
}

// ── weights ───────────────────────────────────────────────────────────────────
/** Drop ≤0 weights, merge duplicate symbols, renormalize to whole-number 100; last item absorbs rounding. */
export function normalizeWeights<T extends { symbol: string; weightPct: number }>(items: T[]): T[] {
  const merged = new Map<string, T>();
  for (const it of items) {
    const w = Number(it.weightPct);
    if (!Number.isFinite(w) || w <= 0) continue;
    const prev = merged.get(it.symbol);
    merged.set(it.symbol, prev ? { ...prev, weightPct: prev.weightPct + w } : { ...it, weightPct: w });
  }
  const list = [...merged.values()];
  const total = list.reduce((s, i) => s + i.weightPct, 0);
  if (list.length === 0 || total <= 0) return [];
  const out = list.map((i) => ({ ...i, weightPct: Math.round((i.weightPct / total) * 100) }));
  const drift = 100 - out.reduce((s, i) => s + i.weightPct, 0);
  out[out.length - 1].weightPct += drift;
  // A tiny weight can round to 0 (or below after absorbing drift): drop it and re-run.
  if (out.some((i) => i.weightPct <= 0)) return normalizeWeights(out.filter((i) => i.weightPct > 0));
  return out;
}

// ── curated ───────────────────────────────────────────────────────────────────
type Seed = Omit<Basket, "id" | "chain" | "riskScore" | "author" | "createdAt"> & { slug: string };

const CURATED_AT = 1_756_684_800; // 2026-09-01

function curated(chain: ChainKey, seeds: Seed[]): Basket[] {
  const c = getChain(chain);
  return seeds.map(({ slug, ...s }) => ({
    ...s,
    id: `${chain}:${slug}`,
    chain,
    items: normalizeWeights(s.items),
    riskScore: riskScoreFor(c, s.items),
    author: "stax" as const,
    createdAt: CURATED_AT,
  }));
}

const BASE_SEEDS: Seed[] = [
  {
    slug: "big-tech",
    name: "Big Tech",
    tagline: "The four names everyone knows, in one tap.",
    icon: "building",
    color: "#3b5bdb",
    items: [
      { symbol: "AAPL", weightPct: 30, reason: "The steady anchor: a giant with a loyal customer base." },
      { symbol: "GOOGL", weightPct: 25, reason: "Search, YouTube, and cloud income in one company." },
      { symbol: "NVDA", weightPct: 25, reason: "The chips behind most of today's AI." },
      { symbol: "META", weightPct: 20, reason: "Billions of daily users, mostly paid for by ads." },
    ],
  },
  {
    slug: "ai-chips",
    name: "AI & Chips",
    tagline: "A focused bet on the companies building AI.",
    icon: "cpu",
    color: "#4a7d2c",
    items: [
      { symbol: "NVDA", weightPct: 50, reason: "Makes the chips that train and run AI." },
      { symbol: "GOOGL", weightPct: 25, reason: "Builds its own AI and the cloud it runs on." },
      { symbol: "META", weightPct: 25, reason: "Spending heavily to put AI in apps billions use." },
    ],
  },
  {
    slug: "coinbase-ecosystem",
    name: "Coinbase Ecosystem",
    tagline: "The exchange plus the coins it trades most.",
    icon: "layers",
    color: "#1652f0",
    items: [
      { symbol: "COIN", weightPct: 40, reason: "The company that issues these very shares." },
      { symbol: "BTC", weightPct: 35, reason: "The original cryptocurrency." },
      { symbol: "ETH", weightPct: 25, reason: "The network Base itself runs on." },
    ],
  },
  {
    slug: "stocks-crypto",
    name: "Stocks & Crypto",
    tagline: "Two big tech names next to the two big coins.",
    icon: "coins",
    color: "#c47a2c",
    items: [
      { symbol: "NVDA", weightPct: 30, reason: "The AI chip leader." },
      { symbol: "GOOGL", weightPct: 30, reason: "A profitable giant with search and cloud." },
      { symbol: "BTC", weightPct: 20, reason: "Bitcoin, held as Coinbase-backed cbBTC." },
      { symbol: "ETH", weightPct: 20, reason: "Ether, the coin that runs Ethereum and Base." },
    ],
  },
  {
    slug: "safe-growth",
    name: "Safe Growth",
    tagline: "Almost half stays in earning dollars. The rest grows.",
    icon: "sprout",
    color: "#2e6f5e",
    items: [
      { symbol: "aUSDC", weightPct: 40, reason: "A calm cushion that still earns a little." },
      { symbol: "AAPL", weightPct: 20, reason: "A steady, profitable household name." },
      { symbol: "GOOGL", weightPct: 20, reason: "Search and cloud income that keeps growing." },
      { symbol: "NVDA", weightPct: 20, reason: "A measured slice of the AI leader." },
    ],
  },
  {
    slug: "frontier",
    name: "Frontier",
    tagline: "Rockets, chips, and Bitcoin. Expect big swings.",
    icon: "rocket",
    color: "#7c6fcf",
    items: [
      { symbol: "SPCX", weightPct: 40, reason: "A rare piece of a private space company." },
      { symbol: "NVDA", weightPct: 35, reason: "The chips behind the AI boom." },
      { symbol: "BTC", weightPct: 25, reason: "Bitcoin, known for large ups and downs." },
    ],
  },
  {
    slug: "bitcoin-blue-chips",
    name: "Bitcoin & Blue Chips",
    tagline: "A third in Bitcoin, the rest in steady giants.",
    icon: "bitcoin",
    color: "#d08a2a",
    items: [
      { symbol: "BTC", weightPct: 35, reason: "Bitcoin, held as Coinbase-backed cbBTC." },
      { symbol: "AAPL", weightPct: 25, reason: "A steady anchor with loyal customers." },
      { symbol: "NVDA", weightPct: 20, reason: "The AI chip leader." },
      { symbol: "GOOGL", weightPct: 20, reason: "Search, YouTube, and cloud in one name." },
    ],
  },
];

const MANTLE_SEEDS: Seed[] = [
  {
    slug: "big-tech",
    name: "Big Tech",
    tagline: "The four names everyone knows, in one tap.",
    icon: "building",
    color: "#3b5bdb",
    items: [
      { symbol: "AAPL", weightPct: 30, reason: "The steady anchor: a giant with a loyal customer base." },
      { symbol: "GOOGL", weightPct: 25, reason: "Search, YouTube, and cloud income in one company." },
      { symbol: "NVDA", weightPct: 25, reason: "The chips behind most of today's AI." },
      { symbol: "META", weightPct: 20, reason: "Billions of daily users, mostly paid for by ads." },
    ],
  },
  {
    slug: "broad-market",
    name: "Broad Market",
    tagline: "Hundreds of companies at once. A classic first step.",
    icon: "globe",
    color: "#1f6f54",
    items: [
      { symbol: "SPY", weightPct: 60, reason: "The 500 largest US companies in one fund." },
      { symbol: "QQQ", weightPct: 40, reason: "The 100 biggest Nasdaq names, tech-heavy." },
    ],
  },
  {
    slug: "steady-start",
    name: "Steady Start",
    tagline: "Mostly the whole market, with two giants on top.",
    icon: "sprout",
    color: "#2e6f5e",
    items: [
      { symbol: "SPY", weightPct: 60, reason: "Spread across the whole US market." },
      { symbol: "AAPL", weightPct: 20, reason: "A steady, profitable household name." },
      { symbol: "GOOGL", weightPct: 20, reason: "Search and cloud income that keeps growing." },
    ],
  },
  {
    slug: "ai-chips",
    name: "AI & Chips",
    tagline: "A focused bet on the companies building AI.",
    icon: "cpu",
    color: "#4a7d2c",
    items: [
      { symbol: "NVDA", weightPct: 50, reason: "Makes the chips that train and run AI." },
      { symbol: "GOOGL", weightPct: 25, reason: "Builds its own AI and the cloud it runs on." },
      { symbol: "META", weightPct: 25, reason: "Spending heavily to put AI in apps billions use." },
    ],
  },
  {
    slug: "crypto-blue-chips",
    name: "Crypto Blue Chips",
    tagline: "Staked Ether beside two steady tech names.",
    icon: "gem",
    color: "#5b7fd0",
    items: [
      { symbol: "mETH", weightPct: 40, reason: "Ether that earns a staking reward on top." },
      { symbol: "NVDA", weightPct: 30, reason: "The AI chip leader." },
      { symbol: "AAPL", weightPct: 30, reason: "A profitable anchor for the basket." },
    ],
  },
];

/** Every curated seed, per chain — unfiltered. Use `curatedBaskets(chain)` for what to show. */
export const CURATED_BASKETS: Record<ChainKey, Basket[]> = {
  base: curated("base", BASE_SEEDS),
  mantle: curated("mantle", MANTLE_SEEDS),
};

/** True when every holding is buyable on `chain` right now. */
export function isBasketInvestable(chain: StaxChain, basket: { items: BasketItem[] }): boolean {
  return basket.items.length > 0 && basket.items.every((i) => isRoutable(chain, i.symbol));
}

/** Curated baskets that are fully investable on `chain` today (never shown broken). */
export function curatedBaskets(chain: StaxChain): Basket[] {
  return CURATED_BASKETS[chain.key].filter((b) => isBasketInvestable(chain, b));
}

// ── conversions ───────────────────────────────────────────────────────────────
function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : text).trim();
}

/** A basket-sized name from a longer line: whole words only, no trailing punctuation. */
export function shortName(text: string, max = BASKET_NAME_MAX): string {
  const t = text.trim();
  if (t.length <= max) return t.replace(/[.,;:!?]+$/, "");
  const cut = t.slice(0, max + 1);
  const atWord = cut.lastIndexOf(" ");
  return (atWord > 8 ? cut.slice(0, atWord) : cut.slice(0, max)).replace(/[.,;:!?]+$/, "");
}

/** Default one-line "why" for a holding: the display description's first sentence. */
export function reasonFor(symbol: string): string {
  return firstSentence(displayFor(symbol).desc);
}

/** The AllocateResult shape PlanScreen + useInvest.invest expect. */
export function basketToAllocation(basket: Basket, amountUsd: number): AllocateResult {
  return {
    summary: basket.name,
    rationale: basket.tagline,
    riskScore: basket.riskScore,
    allocations: basket.items.map((i) => ({
      symbol: i.symbol,
      weightPct: i.weightPct,
      reason: i.reason ?? reasonFor(i.symbol),
    })),
    amountUsd,
    model: "basket",
    chain: basket.chain,
  };
}

const PALETTE = ["#3b5bdb", "#2e6f5e", "#c47a2c", "#4a7d2c", "#5b7fd0", "#b03a2e", "#1f6f54", "#d08a2a"];

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Deterministic accent for a basket without an authored color. */
export function colorFor(seed: string): string {
  return PALETTE[hashStr(seed) % PALETTE.length];
}

function randomId(): string {
  const r =
    typeof crypto !== "undefined" && "getRandomValues" in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36)).join("")
      : Math.random().toString(36).slice(2, 10);
  return `p_${Date.now().toString(36)}${r}`.slice(0, 24);
}

/** "Save as basket" from a Vera plan (or any allocation). Drops non-routable symbols. */
export function allocationToBasket(
  chain: StaxChain,
  allocation: Allocation,
  name: string,
  goal?: string,
  opts: { author?: BasketAuthor; icon?: BasketIcon; now?: number } = {},
): Basket {
  const items = normalizeWeights(
    allocation.allocations
      .filter((a) => isRoutable(chain, a.symbol))
      .map((a) => ({ symbol: a.symbol, weightPct: a.weightPct, reason: a.reason })),
  );
  const cleanName = cleanText(name, BASKET_NAME_MAX) || shortName(cleanText(allocation.summary, 200)) || "My basket";
  return {
    id: randomId(),
    chain: chain.key,
    name: cleanName,
    tagline: cleanText(allocation.rationale, BASKET_TAGLINE_MAX),
    icon: opts.icon ?? "sparkles",
    color: colorFor(cleanName),
    items,
    riskScore: riskScoreFor(chain, items),
    author: opts.author ?? "you",
    createdAt: opts.now ?? Math.floor(Date.now() / 1000),
    source: goal ? { goal } : undefined,
  };
}

// ── links ─────────────────────────────────────────────────────────────────────
interface LinkPayload {
  v: 1;
  c: ChainKey;
  n: string;
  t: string;
  e: string;
  i: [string, number][];
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
    const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Strip control characters + collapse whitespace; hard cap length. */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// A known icon name, else the default basket glyph.
function cleanIcon(v: unknown): BasketIcon {
  return typeof v === "string" && (BASKET_ICONS as readonly string[]).includes(v) ? (v as BasketIcon) : "basket";
}

/** Compact base64url payload for `/app?basket=<param>`. Risk and color are never carried. */
export function encodeBasketLink(basket: Basket): string {
  const payload: LinkPayload = {
    v: 1,
    c: basket.chain,
    n: basket.name.slice(0, BASKET_NAME_MAX),
    t: basket.tagline.slice(0, BASKET_TAGLINE_MAX),
    e: basket.icon,
    i: basket.items.map((i) => [i.symbol, i.weightPct]),
  };
  return toBase64Url(JSON.stringify(payload));
}

export type DecodeResult = { ok: true; basket: Basket } | { ok: false; reason: string };

/** Untrusted basket contents (a share link or a POST body) before validation. */
export interface SharedBasketInput {
  chain: unknown;
  name: unknown;
  tagline: unknown;
  icon: unknown;
  /** `[symbol, pct]` tuples (links) or `{symbol, weightPct}` objects (API). */
  items: unknown;
  /** Id for the result (a server short id); defaults to a hash of the contents. */
  id?: string;
  source?: { goal?: unknown };
}

/**
 * Validate untrusted basket contents into a "shared" basket. Trusts nothing: chain
 * must be known, symbols must be routable on that chain, weights are renormalized
 * (rejected if they add up past 100), risk is recomputed, and the author is always
 * "shared". Shared by decodeBasketLink (links) and the baskets API (stored baskets).
 */
export function sharedBasketFrom(input: SharedBasketInput, now = Math.floor(Date.now() / 1000)): DecodeResult {
  const bad = { ok: false as const, reason: "That link doesn't look like a Stax basket." };
  if (!isChainKey(input.chain) || !Array.isArray(input.items)) return bad;
  const chain = getChain(input.chain);

  if (input.items.length === 0 || input.items.length > BASKET_MAX_ITEMS) {
    return { ok: false, reason: `A basket can hold 1 to ${BASKET_MAX_ITEMS} holdings.` };
  }
  const items: BasketItem[] = [];
  let total = 0;
  for (const entry of input.items as unknown[]) {
    const [rawSymbol, rawWeight] = Array.isArray(entry)
      ? [entry[0], entry[1]]
      : entry && typeof entry === "object"
        ? [(entry as { symbol?: unknown }).symbol, (entry as { weightPct?: unknown }).weightPct]
        : [undefined, undefined];
    const symbol = cleanText(rawSymbol, 12);
    const w = Number(rawWeight);
    if (!symbol || !Number.isFinite(w)) return bad;
    if (w <= 0) continue;
    total += w;
    // Symbols are case-sensitive in the registry ("aUSDC", "mETH"): match exactly.
    if (!isRoutable(chain, symbol)) {
      return { ok: false, reason: `This basket includes something you can't buy on ${chain.name} yet.` };
    }
    items.push({ symbol, weightPct: w });
  }
  if (total > 100.5) return { ok: false, reason: "The weights in that link add up to more than 100%." };
  const normalized = normalizeWeights(items);
  if (normalized.length === 0) return bad;

  const name = cleanText(input.name, BASKET_NAME_MAX) || "Shared basket";
  const tagline = cleanText(input.tagline, BASKET_TAGLINE_MAX) || "A basket someone shared with you.";
  const contents = `${chain.key}|${name}|${normalized.map((i) => `${i.symbol}:${i.weightPct}`).join(",")}`;
  const goal = cleanText(input.source?.goal, 200);
  return {
    ok: true,
    basket: {
      id: input.id ?? `s_${hashStr(contents).toString(36)}`,
      chain: chain.key,
      name,
      tagline,
      icon: cleanIcon(input.icon),
      color: colorFor(name),
      items: normalized,
      riskScore: riskScoreFor(chain, normalized),
      author: "shared",
      createdAt: now,
      ...(goal ? { source: { goal } } : {}),
    },
  };
}

/**
 * Decode a shared link. Trusts nothing: chain must be known, symbols must be routable on
 * that chain, weights are renormalized (rejected if they add up past 100), risk is
 * recomputed, and the author is always "shared".
 */
export function decodeBasketLink(param: string | null | undefined, now = Math.floor(Date.now() / 1000)): DecodeResult {
  const bad = { ok: false as const, reason: "That link doesn't look like a Stax basket." };
  if (!param || param.length > 4096) return bad;
  const json = fromBase64Url(param);
  if (!json) return bad;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return bad;
  }
  if (!raw || typeof raw !== "object") return bad;
  const p = raw as Partial<LinkPayload>;
  if (p.v !== 1) return bad;
  return sharedBasketFrom({ chain: p.c, name: p.n, tagline: p.t, icon: p.e, items: p.i }, now);
}

// ── short links ───────────────────────────────────────────────────────────────
// Server-stored baskets (POST /api/baskets) get an 8-char base62 id and a short
// `/app?b=<id>` link. The encoded `?basket=` link above keeps working everywhere.
export const BASKET_SHORT_ID_LENGTH = 8;
const SHORT_ID_RE = /^[0-9A-Za-z]{8}$/;

/** True for a well-formed short id — a cheap pre-check before any fetch or query. */
export function isBasketShortId(v: unknown): v is string {
  return typeof v === "string" && SHORT_ID_RE.test(v);
}

/** Absolute short share URL (the app's `?b=<id>`) for a server-stored basket. */
export function basketShortUrl(id: string, origin?: string): string {
  return origin ? `${origin}/app?b=${id}` : absoluteAppUrl(`?b=${id}`);
}

/** Absolute share URL for a basket (the app's `?basket=…`). */
export function basketShareUrl(basket: Basket, origin?: string): string {
  return origin ? `${origin}/app?basket=${encodeBasketLink(basket)}` : absoluteAppUrl(`?basket=${encodeBasketLink(basket)}`);
}
