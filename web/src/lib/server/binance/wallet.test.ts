// Wave 5b "money" stream: the portfolio route needs balances for ~85 BSC addresses (42 stocks +
// most twins + 3 crypto), but a single Wallet API call caps at 20 (wallet.ts's own `balances`
// guard). `balancesBatched` is the chunking wrapper that makes that a non-issue for a caller —
// and `rawBalanceMap` turns the parsed rows into the address->bigint lookup the portfolio route
// actually wants, with a MISSING address (Binance dropped or never recognized it) read the same
// way an unheld token would be: absent, not zero, so the caller decides the default.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({ web3Request: vi.fn() }));

import { web3Request } from "./client";

const mockWeb3Request = vi.mocked(web3Request);
const ADDR = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as const;

const tokenAsset = (addr: string, raw: string) => ({
  binanceChainId: "56",
  tokenContractAddress: addr,
  address: ADDR,
  symbol: addr.slice(0, 8),
  balance: "0",
  rawBalance: raw,
  tokenPrice: "",
  isRiskToken: false,
});

beforeEach(() => {
  vi.resetModules();
  mockWeb3Request.mockReset();
});

describe("balancesBatched", () => {
  it("makes one call for 20 or fewer tokens", async () => {
    const { balancesBatched } = await import("./wallet");
    const tokens = Array.from({ length: 20 }, (_, i) => `0x${i.toString().padStart(40, "0")}` as `0x${string}`);
    mockWeb3Request.mockResolvedValueOnce([{ tokenAssets: tokens.map((t) => tokenAsset(t, "0")) }]);
    const result = await balancesBatched(ADDR, tokens);
    expect(mockWeb3Request).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(20);
  });

  it("chunks more than 20 tokens into serial calls of at most 20 and merges the results in order", async () => {
    const { balancesBatched } = await import("./wallet");
    const tokens = Array.from({ length: 45 }, (_, i) => `0x${i.toString().padStart(40, "0")}` as `0x${string}`);
    mockWeb3Request
      .mockResolvedValueOnce([{ tokenAssets: tokens.slice(0, 20).map((t) => tokenAsset(t, "1")) }])
      .mockResolvedValueOnce([{ tokenAssets: tokens.slice(20, 40).map((t) => tokenAsset(t, "2")) }])
      .mockResolvedValueOnce([{ tokenAssets: tokens.slice(40, 45).map((t) => tokenAsset(t, "3")) }]);

    const result = await balancesBatched(ADDR, tokens);

    expect(mockWeb3Request).toHaveBeenCalledTimes(3);
    // Every call's body carried at most 20 addresses.
    for (const call of mockWeb3Request.mock.calls) {
      const body = call[3] as { tokenContractAddresses: unknown[] };
      expect(body.tokenContractAddresses.length).toBeLessThanOrEqual(20);
    }
    expect(result).toHaveLength(45);
    expect(result[0].rawBalance).toBe(BigInt(1));
    expect(result[20].rawBalance).toBe(BigInt(2));
    expect(result[44].rawBalance).toBe(BigInt(3));
  });

  it("returns an empty array without calling Binance when there are no tokens to look up", async () => {
    const { balancesBatched } = await import("./wallet");
    const result = await balancesBatched(ADDR, []);
    expect(result).toEqual([]);
    expect(mockWeb3Request).not.toHaveBeenCalled();
  });
});

describe("rawBalanceMap", () => {
  it("maps lowercase token address to raw balance", async () => {
    const { rawBalanceMap } = await import("./wallet");
    const assets = [
      { ...tokenAssetTyped("0xAAA0000000000000000000000000000000000A", "123") },
      { ...tokenAssetTyped("0xbbb0000000000000000000000000000000000b", "456") },
    ];
    const map = rawBalanceMap(assets);
    expect(map.get("0xaaa0000000000000000000000000000000000a")).toBe(BigInt(123));
    expect(map.get("0xbbb0000000000000000000000000000000000b")).toBe(BigInt(456));
  });

  it("leaves an address Binance never returned absent from the map (caller decides the default)", async () => {
    const { rawBalanceMap } = await import("./wallet");
    const map = rawBalanceMap([tokenAssetTyped("0xaaa0000000000000000000000000000000000a", "1")]);
    expect(map.has("0xdead000000000000000000000000000000dead")).toBe(false);
  });
});

// A typed TokenAsset, matching wallet.ts's parsed output shape (rawBalance already bigint).
function tokenAssetTyped(addr: string, raw: string) {
  return {
    binanceChainId: "56",
    tokenContractAddress: addr,
    address: ADDR,
    symbol: "X",
    balance: "0",
    rawBalance: BigInt(raw),
    tokenPrice: null,
    isRiskToken: false,
  };
}

// Review fix (wave 5b): the portfolio route's own 10s cache was shorter than usePortfolio's 30s
// poll, so every poll missed it anyway and still spent Binance calls. The cache now lives here,
// at 45s, and `invalidateBscBalanceCache` lets a caller that just confirmed a send landed force
// the next read fresh instead of waiting out the window.
describe("cachedBscBalances", () => {
  const TOKEN = "0xaaa0000000000000000000000000000000000a" as const;

  it("shares one Binance call across repeated reads within the TTL", async () => {
    vi.useFakeTimers();
    try {
      const { cachedBscBalances, BSC_BALANCE_CACHE_TTL_MS } = await import("./wallet");
      mockWeb3Request.mockResolvedValue([{ tokenAssets: [tokenAsset(TOKEN, "1")] }]);

      await cachedBscBalances(ADDR, [TOKEN]);
      vi.advanceTimersByTime(BSC_BALANCE_CACHE_TTL_MS - 1000);
      await cachedBscBalances(ADDR, [TOKEN]);

      expect(mockWeb3Request).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers a 30s poll interval with room either side (the regression: TTL used to be 10s)", async () => {
    const { BSC_BALANCE_CACHE_TTL_MS } = await import("./wallet");
    expect(BSC_BALANCE_CACHE_TTL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("invalidateBscBalanceCache forces the next read to hit Binance again, even inside the TTL", async () => {
    const { cachedBscBalances, invalidateBscBalanceCache } = await import("./wallet");
    mockWeb3Request.mockResolvedValue([{ tokenAssets: [tokenAsset(TOKEN, "1")] }]);

    await cachedBscBalances(ADDR, [TOKEN]);
    invalidateBscBalanceCache(ADDR);
    await cachedBscBalances(ADDR, [TOKEN]);

    expect(mockWeb3Request).toHaveBeenCalledTimes(2);
  });

  it("doesn't poison later reads after a failure", async () => {
    const { cachedBscBalances } = await import("./wallet");
    mockWeb3Request.mockRejectedValueOnce(new Error("network down"));
    await expect(cachedBscBalances(ADDR, [TOKEN])).rejects.toThrow("network down");

    mockWeb3Request.mockResolvedValueOnce([{ tokenAssets: [tokenAsset(TOKEN, "1")] }]);
    const map = await cachedBscBalances(ADDR, [TOKEN]);
    expect(map.get(TOKEN)).toBe(BigInt(1));
  });
});
