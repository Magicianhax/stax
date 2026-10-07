"use client";

// The user's selected network on the client — a tiny external store so both React
// components (`useChain`) and plain modules (aa.ts, authedFetch.ts) read the same value.
// Persisted in localStorage; default is BNB Chain. The key is versioned: `stax.chain` held the
// choice from when Base was the default, and ignoring it lands everyone on BNB Chain once. A choice
// made after that sticks.
import { useSyncExternalStore } from "react";
import { pinMount, unpinMount } from "./demoPin";
import { CHAINS, DEFAULT_CHAIN_KEY, isChainKey, type ChainKey, type StaxChain } from "./index";

const STORAGE_KEY = "stax.chain.v2";
const listeners = new Set<() => void>();
let current: ChainKey = DEFAULT_CHAIN_KEY;
let hydrated = false;
// The demo (/demo and the landing) pins its own network so the visitor's saved choice neither
// decides what the demo shows nor is overwritten by switching networks inside it. Counted per
// mount (demoPin.ts) so two demos can't unpin each other.
let demoPins = { count: 0 };
const isDemoPinned = () => demoPins.count > 0;

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
  if (!isDemoPinned()) {
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
 * later switches being saved. Call it from an effect (never during render, so SSR leaves module
 * state alone). The first mount sets the network and notifies subscribers; later mounts only
 * add to the count.
 */
export function pinDemoChain(key: ChainKey) {
  const r = pinMount(demoPins);
  demoPins = r.state;
  if (!r.first) return;
  hydrated = true;
  const changed = current !== key;
  current = key;
  if (changed) listeners.forEach((l) => l());
}

/** Undo one pinDemoChain. When the last demo goes, the saved choice (or the default) is read again. */
export function unpinDemoChain() {
  const r = unpinMount(demoPins);
  demoPins = r.state;
  if (!r.last) return;
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
