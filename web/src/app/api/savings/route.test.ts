// Review fix (wave 5b): GET /api/savings used to be rate-only. Now that Savings has a balance
// (getSavingsBalanceUsd), the route needs to carry it WITHOUT breaking the address-less, cacheable
// rate response every other viewer still gets — a per-address number must never leak into a
// `public, s-maxage=…` response another browser could reuse.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
// GET never touches auth, the smart-account table, or the rate limiter, but route.ts's module
// scope imports all three for POST — mocked here purely so importing the module doesn't also
// pull in the real DB client (which throws without a DATABASE_URL in this test environment).
vi.mock("@/lib/server/privyAuth", () => ({ verifyRequest: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({ requireApproved: vi.fn() }));
vi.mock("@/lib/server/users", () => ({ getSmartAccount: vi.fn() }));
vi.mock("@/lib/server/rateLimit", () => ({ rateLimit: vi.fn() }));

const getSavingsRateSpy = vi.fn();
const getSavingsBalanceUsdSpy = vi.fn();
vi.mock("@/lib/server/savings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/savings")>("@/lib/server/savings");
  return {
    ...actual,
    getSavingsRate: () => getSavingsRateSpy(),
    getSavingsBalanceUsd: (...args: unknown[]) => getSavingsBalanceUsdSpy(...args),
  };
});

import { GET } from "./route";

const ADDR = "0xF977814e90dA44bFA03b6295A0616a897441aceC";

function reqFor(chain: string, address?: string): NextRequest {
  const q = new URLSearchParams({ chain, ...(address ? { address } : {}) });
  return new NextRequest(`http://localhost/api/savings?${q}`);
}

beforeEach(() => {
  getSavingsRateSpy.mockReset().mockResolvedValue({ apyBps: 338, apyDisplay: "3.38%" });
  getSavingsBalanceUsdSpy.mockReset();
});

describe("GET /api/savings", () => {
  it("omits balanceUsd entirely, and stays cacheable, when no address is given", async () => {
    const res = await GET(reqFor("bsc"));
    const body = await res.json();
    expect(body).not.toHaveProperty("balanceUsd");
    expect(getSavingsBalanceUsdSpy).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toMatch(/public/);
  });

  it("includes the caller's balance, and turns off caching, when a valid address is given", async () => {
    getSavingsBalanceUsdSpy.mockResolvedValueOnce(24.5);
    const res = await GET(reqFor("bsc", ADDR));
    const body = await res.json();
    expect(body.balanceUsd).toBe(24.5);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports null (not $0, not an error) when the address holds no vUSDT", async () => {
    getSavingsBalanceUsdSpy.mockResolvedValueOnce(null);
    const res = await GET(reqFor("bsc", ADDR));
    const body = await res.json();
    expect(body.balanceUsd).toBeNull();
  });

  it("ignores a malformed address rather than passing it through to the balance reader", async () => {
    const res = await GET(reqFor("bsc", "not-an-address"));
    const body = await res.json();
    expect(body).not.toHaveProperty("balanceUsd");
    expect(getSavingsBalanceUsdSpy).not.toHaveBeenCalled();
  });

  it("never reads a balance off BSC", async () => {
    const res = await GET(reqFor("base", ADDR));
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body).not.toHaveProperty("balanceUsd");
    expect(getSavingsBalanceUsdSpy).not.toHaveBeenCalled();
  });
});
