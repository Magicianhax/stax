// POST /api/me/account must accept BNB Chain: Autopilot now requires a registered smart account,
// so a BSC user who could never register one would be locked out.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/server/privyAuth", () => ({ verifyRequest: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/server/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue({ ok: true }) }));
const upsertMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/server/users", () => ({
  touchUser: vi.fn().mockResolvedValue(undefined),
  upsertSmartAccount: (...a: unknown[]) => upsertMock(...a),
}));

import { POST } from "./route";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const req = (chain: string) =>
  new NextRequest("http://localhost/api/me/account", {
    method: "POST",
    body: JSON.stringify({ chain, owner: A, address: B }),
    headers: { "content-type": "application/json" },
  });

describe("POST /api/me/account", () => {
  it("registers a BNB Chain account", async () => {
    expect((await POST(req("bsc"))).status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ chain: "bsc" }));
  });
  it("still rejects an unknown chain", async () => {
    expect((await POST(req("solana"))).status).toBe(400);
  });
});
