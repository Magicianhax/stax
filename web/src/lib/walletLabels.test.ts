import { describe, expect, it } from "vitest";
import { getChain } from "./chains";
import { VENUS_VUSDT_ADDRESS } from "./execution";
import { isInvestKind, walletTxKind, walletTxParty, walletTxTitle } from "./walletLabels";

const bsc = getChain("bsc");
const base = getChain("base");
const ROUTER = bsc.routers.binance!;

const tx = (over: Partial<{ direction: "in" | "out"; counterparty: string; symbol: string }>) => ({
  direction: "out" as const,
  counterparty: "0x000000000000000000000000000000000000dEaD",
  symbol: "USDT",
  ...over,
});

describe("walletTxKind on BNB Chain", () => {
  it("reads cash sent to the Binance router as an investment, not 'Sent USDT'", () => {
    const t = tx({ counterparty: ROUTER });
    expect(walletTxKind(bsc, t)).toBe("router_buy");
    expect(walletTxTitle("router_buy", t)).toBe("Invested");
    expect(isInvestKind("router_buy")).toBe(true);
  });

  it("reads a stock sent to the router as a sale", () => {
    const t = tx({ counterparty: ROUTER, symbol: "NVDA" });
    expect(walletTxKind(bsc, t)).toBe("router_sale");
    expect(walletTxTitle("router_sale", t)).toBe("Sold NVDA");
  });

  it("reads Venus transfers as Savings moves, in both directions", () => {
    const into = tx({ counterparty: VENUS_VUSDT_ADDRESS });
    const out = tx({ counterparty: VENUS_VUSDT_ADDRESS.toLowerCase(), direction: "in" });
    expect(walletTxTitle(walletTxKind(bsc, into), into)).toBe("Moved to Savings");
    expect(walletTxTitle(walletTxKind(bsc, out), out)).toBe("Moved back from Savings");
    expect(walletTxParty("savings_in")?.value).toMatch(/Savings/);
  });

  it("leaves an ordinary send alone", () => {
    expect(walletTxKind(bsc, tx({}))).toBe("plain");
    expect(walletTxTitle("plain", tx({}))).toBe("Sent USDT");
  });
});

describe("walletTxKind elsewhere", () => {
  it("still recognises cash sent to the executor as a plan", () => {
    const t = tx({ counterparty: base.contracts.executor });
    expect(walletTxKind(base, t)).toBe("executor_invest");
    expect(walletTxParty("executor_invest")).toEqual({ label: "Placed by", value: "Vera · Stax executor" });
  });

  it("does not apply BNB Chain's router or Venus rules on Base", () => {
    expect(walletTxKind(base, tx({ counterparty: VENUS_VUSDT_ADDRESS }))).toBe("plain");
  });
});
