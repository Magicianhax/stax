import { describe, expect, it } from "vitest";
import { pinMount, unpinMount } from "./demoPin";

describe("demo pin counter", () => {
  it("pins on the first mount only, unpins on the last unmount only", () => {
    let s = { count: 0 };
    const a = pinMount(s);
    expect(a.first).toBe(true);
    s = a.state;
    const b = pinMount(s);
    expect(b.first).toBe(false);
    s = b.state;
    const c = unpinMount(s);
    expect(c.last).toBe(false); // another demo is still mounted
    s = c.state;
    const d = unpinMount(s);
    expect(d.last).toBe(true);
    expect(d.state.count).toBe(0);
  });

  it("never goes negative on a stray unpin", () => {
    const r = unpinMount({ count: 0 });
    expect(r.last).toBe(false);
    expect(r.state.count).toBe(0);
  });
});
