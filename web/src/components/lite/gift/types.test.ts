import { describe, expect, it } from "vitest";
import { pillFor } from "./types";

const NOW = Date.parse("2026-09-14T12:00:00Z");
const PAST = "2026-09-10T12:00:00Z";
const FUTURE = "2026-09-20T12:00:00Z";

describe("pillFor", () => {
  it("reads a received gift from the server's claimable flag", () => {
    expect(pillFor({ status: "funded", claimable: true, direction: "received", unlockAt: PAST }, NOW)).toBe("ready");
    expect(pillFor({ status: "funded", claimable: false, direction: "received", unlockAt: FUTURE }, NOW)).toBe("waiting");
  });

  it("never calls a sent gift past its date 'waiting'", () => {
    expect(pillFor({ status: "funded", claimable: false, direction: "sent", unlockAt: PAST }, NOW)).toBe("ready");
    expect(pillFor({ status: "funded", claimable: false, direction: "sent", unlockAt: FUTURE }, NOW)).toBe("waiting");
  });

  it("lets a settled status win over the clock", () => {
    expect(pillFor({ status: "claimed", direction: "sent", unlockAt: PAST }, NOW)).toBe("claimed");
    expect(pillFor({ status: "reclaimed", direction: "sent", unlockAt: PAST }, NOW)).toBe("returned");
    expect(pillFor({ status: "failed", direction: "sent", unlockAt: PAST }, NOW)).toBe("failed");
    expect(pillFor({ status: "pending", direction: "sent", unlockAt: PAST }, NOW)).toBe("preparing");
  });
});
