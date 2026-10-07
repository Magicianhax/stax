// BSC is one more StaxChain. These pin the facts every other task builds on.
import { describe, expect, it } from "vitest";
import { CHAIN_KEYS, getChain, investableAssets, isChainKey, isRoutable } from "./index";

describe("bsc chain", () => {
  it("is registered", () => {
    expect(CHAIN_KEYS).toContain("bsc");
    expect(isChainKey("bsc")).toBe(true);
    expect(getChain("bsc").id).toBe(56);
  });

  it("uses 18-decimal USDT as cash", () => {
    const c = getChain("bsc");
    expect(c.usdc).toEqual({
      address: "0x55d398326f99059fF775485246999027B3197955",
      symbol: "USDT",
      decimals: 18,
    });
  });

  it("routes tokenized stocks through the Binance aggregator", () => {
    const c = getChain("bsc");
    expect(c.routers.binance).toBe("0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5");
    expect(isRoutable(c, "NVDA")).toBe(true);
    expect(investableAssets(c).length).toBeGreaterThan(0);
  });

  it("is live on the executor path since the 2026-10-07 test, with the deployed addresses unchanged", () => {
    const c = getChain("bsc").contracts;
    expect(c.deployed).toBe(true);
    expect(c.executor).toBe("0xc8b10b6be1ce78df53d2e3159d83dca113e4b133");
    expect(c.verifier).toBe("0xc1efb92d4cdf6e2249038c7186ebc12cf42ef4d8");
    expect(c.registry).toBe("0xb94a10cf369a0e83f102a6facd318497a338b77c");
    expect(c.agentId).toBe(BigInt(1));
    expect(c.executorBlock).toBe(BigInt(123802297));
  });

  it("leaves Base and Mantle exactly as they were", () => {
    expect(getChain("base").usdc.decimals).toBe(6);
    expect(getChain("base").usdc.symbol).toBe("USDC");
    expect(getChain("mantle").id).toBe(5000);
  });
});

describe("default chain", () => {
  it("is BNB Chain, listed first in the network switch", async () => {
    const { DEFAULT_CHAIN_KEY, CHAIN_KEYS, getChain } = await import("./index");
    expect(DEFAULT_CHAIN_KEY).toBe("bsc");
    expect(CHAIN_KEYS[0]).toBe("bsc");
    expect(getChain(undefined).key).toBe("bsc");
  });
});
