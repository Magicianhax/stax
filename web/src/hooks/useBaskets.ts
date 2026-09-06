"use client";

// useBaskets — curated + personal baskets for the ACTIVE chain.
//
// Personal baskets live in localStorage["stax.baskets.<chainKey>"] behind a tiny
// external store (same pattern as lib/chains/active.ts) so every screen re-renders
// on save/remove. Curated baskets come from code and are filtered at read time to
// what is fully investable on the chain today. Demo mode uses its own storage
// prefix, seeded with one basket, so the landing phones never touch real data.
//
// Sharing: `publish()` saves a basket to the server (POST /api/baskets) and returns
// its short `/app?b=<id>` link — only when signed in and not in demo; otherwise
// null, and callers fall back to the self-contained encoded link. `fetchSharedBasket()`
// resolves a short id back into a basket (re-validated client-side, trusting nothing).
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { ChainKey, StaxChain } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { useDemo } from "@/components/demo/DemoProvider";
import { authedFetch } from "@/lib/authedFetch";
import {
  basketShortUrl,
  curatedBaskets,
  isBasketInvestable,
  isBasketShortId,
  normalizeWeights,
  riskScoreFor,
  sharedBasketFrom,
  type Basket,
  type DecodeResult,
} from "@/lib/baskets";
import { demoSeedBaskets } from "@/lib/demo/demoData";

const EMPTY: Basket[] = [];
const listeners = new Set<() => void>();
// Cached snapshots per storage key — useSyncExternalStore needs a stable reference.
const cache = new Map<string, Basket[]>();

function storageKey(chain: ChainKey, demo: boolean): string {
  return `${demo ? "stax.demo.baskets" : "stax.baskets"}.${chain}`;
}

function isBasket(v: unknown): v is Basket {
  if (!v || typeof v !== "object") return false;
  const b = v as Partial<Basket>;
  return (
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    Array.isArray(b.items) &&
    b.items.every((i) => i && typeof i.symbol === "string" && typeof i.weightPct === "number")
  );
}

function read(key: string): Basket[] {
  const hit = cache.get(key);
  if (hit) return hit;
  let list: Basket[] = EMPTY;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed.filter(isBasket);
    }
  } catch {
    /* private mode / corrupt entry — treat as empty */
  }
  cache.set(key, list);
  return list;
}

function write(key: string, list: Basket[]) {
  cache.set(key, list);
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore — in-memory copy still updates this session */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Re-derive weights + risk on the active chain so stored data can never drift from the registry. */
function rehydrate(chain: StaxChain, b: Basket): Basket {
  const items = normalizeWeights(b.items);
  return { ...b, chain: chain.key, items, riskScore: riskScoreFor(chain, items) };
}

// ── sharing ───────────────────────────────────────────────────────────────────
/** Short ids already minted this session, by basket contents — sharing twice reuses the link. */
const publishedIds = new Map<string, string>();

function contentsKey(b: Basket): string {
  return `${b.chain}|${b.name}|${b.tagline}|${b.icon}|${b.items.map((i) => `${i.symbol}:${i.weightPct}`).join(",")}`;
}

/** Resolve `/app?b=<id>` into a basket. Never throws; the server's answer is re-validated here. */
export async function fetchSharedBasket(id: string): Promise<DecodeResult> {
  const bad = { ok: false as const, reason: "That link doesn't look like a Stax basket." };
  if (!isBasketShortId(id)) return bad;
  try {
    const res = await fetch(`/api/baskets/${id}`);
    const json = (await res.json().catch(() => null)) as { basket?: Record<string, unknown>; error?: string } | null;
    if (!res.ok || !json?.basket) return { ok: false, reason: json?.error || "That basket isn't here. It may have been removed." };
    const b = json.basket;
    return sharedBasketFrom(
      { id, chain: b.chain, name: b.name, tagline: b.tagline, icon: b.icon, items: b.items, source: b.source as { goal?: unknown } | undefined },
      typeof b.createdAt === "number" ? b.createdAt : undefined,
    );
  } catch {
    return { ok: false, reason: "Couldn't load that basket. Check your connection and try again." };
  }
}

export interface UseBaskets {
  /** Made by Stax — only baskets fully investable on the active chain. */
  curated: Basket[];
  /** Yours — saved from a Vera plan or a shared link; personal baskets that are no longer investable are kept but flagged via `isBasketInvestable`. */
  mine: Basket[];
  all: Basket[];
  save: (basket: Basket) => void;
  remove: (id: string) => void;
  byId: (id: string | undefined) => Basket | undefined;
  /** Save to the server for a short link. Null when signed out, in demo, or on any failure. */
  publish: (basket: Basket) => Promise<string | null>;
}

export function useBaskets(): UseBaskets {
  const chain = useChain();
  const demo = useDemo();
  const { authenticated } = usePrivy();
  const key = storageKey(chain.key, demo !== null);

  const stored = useSyncExternalStore(
    subscribe,
    () => {
      // Demo: seed once so "Yours" always has something to look at.
      if (demo && typeof window !== "undefined" && window.localStorage.getItem(key) === null && !cache.has(key)) {
        try {
          window.localStorage.setItem(key, JSON.stringify(demoSeedBaskets(chain.key)));
        } catch {
          cache.set(key, demoSeedBaskets(chain.key));
        }
      }
      return read(key);
    },
    () => EMPTY,
  );

  const mine = useMemo(() => stored.map((b) => rehydrate(chain, b)), [stored, chain]);
  const curated = useMemo(() => curatedBaskets(chain), [chain]);
  const all = useMemo(() => [...mine, ...curated], [mine, curated]);

  const save = useCallback(
    (basket: Basket) => {
      const next: Basket = { ...basket, chain: chain.key, author: basket.author === "stax" ? "you" : basket.author };
      const list = read(key).filter((b) => b.id !== next.id);
      write(key, [next, ...list]);
    },
    [key, chain.key],
  );

  const remove = useCallback(
    (id: string) => {
      write(key, read(key).filter((b) => b.id !== id));
    },
    [key],
  );

  const byId = useCallback((id: string | undefined) => (id ? all.find((b) => b.id === id) : undefined), [all]);

  const publish = useCallback(
    async (basket: Basket): Promise<string | null> => {
      if (demo || !authenticated) return null; // demo never touches the network
      const ck = contentsKey(basket);
      const known = publishedIds.get(ck);
      if (known) return basketShortUrl(known);
      try {
        const res = await authedFetch("/api/baskets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chain: basket.chain,
            name: basket.name,
            tagline: basket.tagline,
            icon: basket.icon,
            items: basket.items.map((i) => ({ symbol: i.symbol, weightPct: i.weightPct })),
            ...(basket.source?.goal ? { source: { goal: basket.source.goal } } : {}),
          }),
        });
        if (!res.ok) return null;
        const { id } = (await res.json()) as { id?: unknown };
        if (!isBasketShortId(id)) return null;
        publishedIds.set(ck, id);
        return basketShortUrl(id);
      } catch {
        return null;
      }
    },
    [demo, authenticated],
  );

  return { curated, mine, all, save, remove, byId, publish };
}

export { isBasketInvestable };
