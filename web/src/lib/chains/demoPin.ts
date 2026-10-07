// Mount counting for the demo's network pin (see active.ts). Pure so the rule is a plain test:
// the pin starts on the first mount and ends only when the last one goes, so two demos on one
// page (landing preview + /demo, or React's dev double-mount) can't unpin each other.
export interface PinState {
  count: number;
}

export function pinMount(s: PinState): { state: PinState; first: boolean } {
  return { state: { count: s.count + 1 }, first: s.count === 0 };
}

export function unpinMount(s: PinState): { state: PinState; last: boolean } {
  if (s.count <= 0) return { state: { count: 0 }, last: false };
  return { state: { count: s.count - 1 }, last: s.count === 1 };
}
