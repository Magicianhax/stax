"use client";

// The user's selected network on the client — a tiny external store so both React
// components (`useChain`) and plain modules (aa.ts, authedFetch.ts) read the same value.
// Persisted in localStorage; default is BNB Chain. The key is versioned: `stax.chain` held the
// choice from when Base was the default, and ignoring it lands everyone on BNB Chain once. A choice
// made after that sticks.
import { useSyncExternalStore } from "react";
import { CHAINS, DEFAULT_CHAIN_KEY, isChainKey, type ChainKey, type StaxChain } from "./index";

const STORAGE_KEY = "stax.chain.v2";
const listeners = new Set<() => void>();
let current: ChainKey = DEFAULT_CHAIN_KEY;
let hydrated = false;
// The demo (/demo and the landing) pins its own network so the visitor's saved choice neither
// decides what the demo shows nor is overwritten by switching networks inside it.
let demoPinned = false;

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
  if (!demoPinned) {
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

/**
 * Pin the active network for a demo mount: ignores what is saved in localStorage and stops
 * later switches being saved. Silent (no listener notification) because it runs while the demo
 * first renders, before anything below it has subscribed.
 */
export function pinDemoChain(key: ChainKey) {
  demoPinned = true;
  hydrated = true;
  current = key;
}

/** Undo pinDemoChain: the saved choice (or the default) is read again on next use. */
export function unpinDemoChain() {
  if (!demoPinned) return;
  demoPinned = false;
  hydrated = false;
  current = DEFAULT_CHAIN_KEY;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The active StaxChain (re-renders on switch). Server snapshot is always the default (BNB Chain). */
export function useChain(): StaxChain {
  const key = useSyncExternalStore(subscribe, getActiveChainKey, () => DEFAULT_CHAIN_KEY);
  return CHAINS[key];
}

export function useChainKey(): [ChainKey, (k: ChainKey) => void] {
  const key = useSyncExternalStore(subscribe, getActiveChainKey, () => DEFAULT_CHAIN_KEY);
  return [key, setActiveChainKey];
}
