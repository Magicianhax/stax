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

  it("starts undeployed, so the executor path stays off", () => {
    expect(getChain("bsc").contracts.deployed).toBe(false);
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
