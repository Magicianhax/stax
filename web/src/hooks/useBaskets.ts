"use client";

// useBaskets — curated + personal baskets for the ACTIVE chain.
//
// Personal baskets live in localStorage["stax.baskets.<chainKey>"] behind a tiny
// external store (same pattern as lib/chains/active.ts) so every screen re-renders
// on save/remove. Curated baskets come from code and are filtered at read time to
// what is fully investable on the chain today. Demo mode uses its own storage
// prefix, seeded with one basket, so the landing phones never touch real data.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ChainKey, StaxChain } from "@/lib/chains";
import { useChain } from "@/lib/chains/active";
import { useDemo } from "@/components/demo/DemoProvider";
import { curatedBaskets, isBasketInvestable, normalizeWeights, riskScoreFor, type Basket } from "@/lib/baskets";
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

export interface UseBaskets {
  /** Made by Stax — only baskets fully investable on the active chain. */
  curated: Basket[];
  /** Yours — saved from a Vera plan or a shared link; personal baskets that are no longer investable are kept but flagged via `isBasketInvestable`. */
  mine: Basket[];
  all: Basket[];
  save: (basket: Basket) => void;
  remove: (id: string) => void;
  byId: (id: string | undefined) => Basket | undefined;
}

export function useBaskets(): UseBaskets {
  const chain = useChain();
  const demo = useDemo();
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

  return { curated, mine, all, save, remove, byId };
}

export { isBasketInvestable };
