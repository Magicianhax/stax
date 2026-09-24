// The cron's auth gate, same shape as app/api/cron/autopilot's own check: a request with no
// bearer token (or the wrong one) never touches the catalog or Redis.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function reqWith(auth?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/spread", {
    headers: auth ? { authorization: auth } : undefined,
  });
}

describe("GET /api/cron/spread", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.SPREAD_CRON_SECRET = "test-secret";
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("401s with no Authorization header", async () => {
    const { GET } = await import("./route");
    const res = await GET(reqWith());
    expect(res.status).toBe(401);
  });

  it("401s with the wrong bearer token", async () => {
    const { GET } = await import("./route");
    const res = await GET(reqWith("Bearer nope"));
    expect(res.status).toBe(401);
  });
});
