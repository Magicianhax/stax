"use client";

// The user's selected network on the client — a tiny external store so both React
// components (`useChain`) and plain modules (aa.ts, authedFetch.ts) read the same value.
// Persisted in localStorage under `stax.chain`; default is Base.
import { useSyncExternalStore } from "react";
import { CHAINS, DEFAULT_CHAIN_KEY, isChainKey, type ChainKey, type StaxChain } from "./index";

const STORAGE_KEY = "stax.chain";
const listeners = new Set<() => void>();
let current: ChainKey = DEFAULT_CHAIN_KEY;
let hydrated = false;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isChainKey(v)) current = v;
  } catch {
    /* private mode etc. — keep default */
  }
}

export function getActiveChainKey(): ChainKey {
  hydrate();
  return current;
}

export function getActiveChain(): StaxChain {
  return CHAINS[getActiveChainKey()];
}

export function setActiveChainKey(key: ChainKey) {
  hydrate();
  if (key === current) return;
  current = key;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The active StaxChain (re-renders on switch). Server snapshot is always the default (Base). */
export function useChain(): StaxChain {
  const key = useSyncExternalStore(subscribe, getActiveChainKey, () => DEFAULT_CHAIN_KEY);
  return CHAINS[key];
}

export function useChainKey(): [ChainKey, (k: ChainKey) => void] {
  const key = useSyncExternalStore(subscribe, getActiveChainKey, () => DEFAULT_CHAIN_KEY);
  return [key, setActiveChainKey];
}
