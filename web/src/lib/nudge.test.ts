import { describe, expect, it } from "vitest";
import { toneAfterNudge } from "./nudge";

describe("toneAfterNudge", () => {
  it("keeps the new tone when the plan was rebuilt", async () => {
    expect(await toneAfterNudge("balanced", "bolder", async () => ({ summary: "ok" }))).toBe("bolder");
  });

  it("goes back to the previous tone when the server refused (the old plan stays)", async () => {
    expect(await toneAfterNudge("balanced", "bolder", async () => null)).toBe("balanced");
  });

  it("waits for the rebuild before answering", async () => {
    let done = false;
    const kept = toneAfterNudge("safer", "simple", async () => {
      await new Promise((r) => setTimeout(r, 5));
      done = true;
      return null;
    });
    expect(done).toBe(false);
    expect(await kept).toBe("safer");
    expect(done).toBe(true);
  });
});
