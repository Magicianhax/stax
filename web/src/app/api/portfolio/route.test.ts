// Review fix (wave 5b): the Wallet API read had two live-unverified assumptions baked in —
// that Binance ever answers, and that every address it's asked about comes back in the response.
// Neither is testable against docs alone, so this exercises the route's own fallback plumbing
// directly: cachedBscBalances throwing entirely (RPC must cover every address), and
// cachedBscBalances succeeding but leaving one stock address out (RPC must backfill just that one
// — not the whole list — and a genuinely-unreadable address still reads as "not held", 0, rather
// than a request-ending error).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 }),
  clientIp: () => "203.0.113.40",
}));

const cachedBscBalancesSpy = vi.fn();
const invalidateSpy = vi.fn();
vi.mock("@/lib/server/binance/wallet", () => ({
  cachedBscBalances: (...args: unknown[]) => cachedBscBalancesSpy(...args),
  invalidateBscBalanceCache: (...args: unknown[]) => invalidateSpy(...args),
}));

vi.mock("@/lib/server/binance", () => ({ getBinanceWeb3: () => ({ rwaTokens: async () => [] }) }));
vi.mock("@/lib/prices", () => ({ priceAll: async () => ({}) }));
vi.mock("@/lib/server/marketData", () => ({ getDaySummary: async () => ({}) }));

const getSavingsBalanceUsdSpy = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/server/savings", () => ({ getSavingsBalanceUsd: (...args: unknown[]) => getSavingsBalanceUsdSpy(...args) }));

const multicallSpy = vi.fn();
vi.mock("@/lib/server/chain", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/chain")>("@/lib/server/chain");
  return {
    ...actual,
    serverClient: () => ({ multicall: multicallSpy }),
  };
});

import { getChain } from "@/lib/chains";
import { GET } from "./route";

const ADDR = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
const bsc = getChain("bsc");
const usdt = bsc.usdc.address.toLowerCase();
const firstStock = bsc.assets.all.find((a) => a.address && a.decimals)!;
const firstStockAddr = firstStock.address!.toLowerCase();

function reqFor(chain: string, extra = ""): NextRequest {
  return new NextRequest(`http://localhost/api/portfolio?address=${ADDR}&chain=${chain}${extra}`);
}

// The exact address set route.ts reads (cash + every stock/crypto default mint + every twin
// mint) — kept here as one helper so "Binance answered for everything" fixtures build a real,
// complete map rather than one that happens to omit addresses the route never asked about.
function allBscReadAddresses(): string[] {
  return [
    bsc.usdc.address,
    ...bsc.assets.all.filter((a) => a.address && a.decimals).map((a) => a.address!),
    ...bsc.assets.all.filter((a) => a.address && a.decimals && a.twin).map((a) => a.twin!.address),
  ];
}

beforeEach(() => {
  cachedBscBalancesSpy.mockReset();
  invalidateSpy.mockReset();
  multicallSpy.mockReset();
  getSavingsBalanceUsdSpy.mockReset().mockResolvedValue(null);
});

describe("GET /api/portfolio on BSC", () => {
  it("falls back to the RPC multicall for every address when Binance throws entirely", async () => {
    cachedBscBalancesSpy.mockRejectedValueOnce(new Error("Binance Wallet API: rate limited"));
    const cashRaw = BigInt(25) * BigInt(10) ** BigInt(18);
    multicallSpy.mockImplementationOnce(async ({ contracts }: { contracts: { address: string }[] }) =>
      contracts.map((c) => (c.address.toLowerCase() === usdt ? { status: "success", result: cashRaw } : { status: "reverted" })),
    );

    const res = await GET(reqFor("bsc"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cashUsd).toBe(25);
    // The whole read fell back to RPC, so multicall covered every candidate address, not a subset.
    const [{ contracts }] = multicallSpy.mock.calls[0];
    expect(contracts.length).toBeGreaterThan(1);
  });

  it("backfills only the address Binance's response left out, and reads it as 0 when RPC can't answer either", async () => {
    // Binance answered for cash and every other address, but never mentioned this ONE stock's
    // address — exactly the "held stock silently dropped" shape the review raised
    // (docs/BINANCE-WEB3.md §6). Everything else in the response is complete on purpose, so a
    // correct fix backfills only the one gap instead of falling back for the whole ~85-address list.
    const balanceMap = new Map<string, bigint>(allBscReadAddresses().map((a) => [a.toLowerCase(), BigInt(0)]));
    balanceMap.set(usdt, BigInt(10) * BigInt(10) ** BigInt(18));
    balanceMap.delete(firstStockAddr);
    cachedBscBalancesSpy.mockResolvedValueOnce(balanceMap);
    multicallSpy.mockImplementationOnce(async ({ contracts }: { contracts: { address: string }[] }) =>
      contracts.map(() => ({ status: "reverted" })),
    );

    const res = await GET(reqFor("bsc"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cashUsd).toBe(10);
    // Backfill was targeted: only the one missing address went to RPC, not the full ~85-address list.
    const [{ contracts }] = multicallSpy.mock.calls[0];
    expect(contracts).toHaveLength(1);
    expect(contracts[0].address.toLowerCase()).toBe(firstStockAddr);
    // Missing from Binance AND unreadable from RPC still reads as "not held" — no row, not a 500.
    expect(body.holdings.find((h: { symbol: string }) => h.symbol === firstStock.symbol)).toBeUndefined();
  });

  it("makes no RPC call at all when Binance's response already covers every address", async () => {
    const fullMap = new Map(allBscReadAddresses().map((a) => [a.toLowerCase(), BigInt(0)]));
    fullMap.set(usdt, BigInt(5) * BigInt(10) ** BigInt(18));
    cachedBscBalancesSpy.mockResolvedValueOnce(fullMap);

    const res = await GET(reqFor("bsc"));
    expect(res.status).toBe(200);
    expect(multicallSpy).not.toHaveBeenCalled();
  });

  it("counts a Savings balance once: in totalUsd, not in investedUsd", async () => {
    const fullMap = new Map(allBscReadAddresses().map((a) => [a.toLowerCase(), BigInt(0)]));
    fullMap.set(usdt, BigInt(10) * BigInt(10) ** BigInt(18));
    cachedBscBalancesSpy.mockResolvedValueOnce(fullMap);
    getSavingsBalanceUsdSpy.mockResolvedValueOnce(6.5);

    const res = await GET(reqFor("bsc"));
    const body = await res.json();

    expect(body.cashUsd).toBe(10);
    expect(body.savingsUsd).toBe(6.5);
    expect(body.investedUsd).toBe(0);
    expect(body.totalUsd).toBeCloseTo(16.5, 6);
  });

  it("reports savingsUsd as 0, never null or missing, when there's nothing in Savings", async () => {
    const fullMap = new Map(allBscReadAddresses().map((a) => [a.toLowerCase(), BigInt(0)]));
    cachedBscBalancesSpy.mockResolvedValueOnce(fullMap);
    getSavingsBalanceUsdSpy.mockResolvedValueOnce(null);

    const res = await GET(reqFor("bsc"));
    const body = await res.json();
    expect(body.savingsUsd).toBe(0);
  });
});

describe("GET /api/portfolio?fresh=1 on BSC (right after the person's own trade)", () => {
  it("skips the Wallet API cache and reads cash from the chain, so Home doesn't animate pre-trade numbers", async () => {
    const stale = new Map(allBscReadAddresses().map((a) => [a.toLowerCase(), BigInt(0)]));
    stale.set(usdt, BigInt(30) * BigInt(10) ** BigInt(18)); // the cached read still says $30
    cachedBscBalancesSpy.mockResolvedValueOnce(stale);
    multicallSpy.mockResolvedValueOnce([{ status: "success", result: BigInt(24) * BigInt(10) ** BigInt(18) }]); // after a $6 buy

    const res = await GET(reqFor("bsc", "&fresh=1"));
    const body = await res.json();

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(body.cashUsd).toBe(24);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves the cache alone on an ordinary poll", async () => {
    cachedBscBalancesSpy.mockResolvedValueOnce(new Map(allBscReadAddresses().map((a) => [a.toLowerCase(), BigInt(0)])));
    await GET(reqFor("bsc"));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
