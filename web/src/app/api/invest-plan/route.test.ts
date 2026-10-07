// POST /api/invest-plan on BNB Chain with the executor live: Vera's plans and baskets get a
// signed executor plan whose legs buy the issuer the plan showed, re-checked buyable first, and
// a Binance dry run of the exact batch the client will send. Base keeps its executor response
// exactly as before (no account lookup, no Binance, no dryRuns). Auth, chain reads, Binance,
// the catalog and the agent signer are mocked; nothing here reaches a network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decodeFunctionData } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/privyAuth", () => ({ verifyRequest: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/server/admin", () => ({ requireApproved: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/server/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue({ ok: true }) }));
const getSmartAccountMock = vi.fn();
vi.mock("@/lib/server/users", () => ({ getSmartAccount: (...a: unknown[]) => getSmartAccountMock(...a) }));

const { chainOverrides } = vi.hoisted(() => ({ chainOverrides: new Map<string, unknown>() }));
const readContractMock = vi.fn();
const getCodeMock = vi.fn();
vi.mock("@/lib/server/chain", async () => {
  const { getChain } = await import("@/lib/chains");
  return {
    chainFromRequest: (req: Request) => {
      const key = req.headers.get("x-stax-chain") ?? "bsc";
      return chainOverrides.get(key) ?? getChain(key);
    },
    serverClient: () => ({ readContract: readContractMock, getCode: getCodeMock }),
  };
});

const quoteMock = vi.fn();
const buildSwapMock = vi.fn();
const rwaTokensMock = vi.fn();
const simulateMock = vi.fn();
vi.mock("@/lib/server/binance", () => ({
  getBinanceWeb3: () => ({ quote: quoteMock, buildSwap: buildSwapMock, rwaTokens: rwaTokensMock, simulate: simulateMock }),
}));
const catalogMock = vi.fn();
vi.mock("@/lib/server/rwaCatalog", () => ({ bscCatalogSnapshot: (...a: unknown[]) => catalogMock(...a) }));
const kyberRouteMock = vi.fn();
const kyberBuildMock = vi.fn();
vi.mock("@/lib/server/kyber", () => ({
  kyberRoute: (...a: unknown[]) => kyberRouteMock(...a),
  kyberBuild: (...a: unknown[]) => kyberBuildMock(...a),
}));
const { SIG } = vi.hoisted(() => ({ SIG: `0x${"33".repeat(65)}` }));
vi.mock("@/lib/eip712", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/eip712")>()),
  signRiskInference: vi.fn().mockResolvedValue(SIG),
}));

import { POST } from "./route";
import { signRiskInference } from "@/lib/eip712";
import { assetBySymbol, getChain } from "@/lib/chains";
import { usdToRaw } from "@/lib/units";
import { ERC20_ABI, STAX_EXECUTOR_ABI } from "@/lib/abis";
import { PLAN_MIN_LEG_MESSAGE } from "@/lib/server/bscPlan";
import type { InvestPlanResult } from "@/lib/invest-types";
import type { StaxChain } from "@/lib/chains/types";
import type { RwaTickerView, VenueView } from "@/lib/rwa";
import type { RwaToken } from "@/lib/server/binance/types";

const bscBase = getChain("bsc");
const bsc: StaxChain = { ...bscBase, contracts: { ...bscBase.contracts, deployed: true } };
const baseChain = getChain("base");
const BASE_EXECUTOR = "0x5555555555555555555555555555555555555555" as const;
const base: StaxChain = { ...baseChain, contracts: { ...baseChain.contracts, executor: BASE_EXECUTOR, deployed: true } };
const ACCOUNT = "0x2222222222222222222222222222222222222222" as const;
const ROUTER = bsc.routers.binance!;
const EXECUTOR = bsc.contracts.executor;
const nvda = assetBySymbol(bsc, "NVDA")!;
const NVDA_B = nvda.address!;
const NVDA_ONDO = nvda.twin!.address;
const NOW = Date.now();

function venue(o: Partial<VenueView> = {}): VenueView {
  return { platform: "bstock", symbol: "NVDAB", address: NVDA_B, tokenPrice: 200, referencePrice: 200, gapPct: 0, state: "open", buyable: true, nextOpenMs: null, updatedAt: NOW, ...o };
}
const nvdaTicker: RwaTickerView = {
  ticker: "NVDA",
  name: "Nvidia",
  type: "stock",
  venues: [venue(), venue({ platform: "ondo", symbol: "NVDAon", address: NVDA_ONDO })],
  bestVenue: "bstock",
};
function row(address: `0x${string}`, open = true): RwaToken {
  return {
    binanceChainId: "56", tokenContractAddress: address, platformId: "bstock", assetType: 1, tokenName: "Nvidia", tokenSymbol: "NVDA",
    tokenLogoUrl: "", decimals: 18, underlyingTicker: "NVDA", underlyingName: "Nvidia", tokenToShareRatio: 1,
    statusInfo: { openState: open, marketStatus: open ? "regular" : "closed", reasonCode: open ? "TRADING" : "MARKET_CLOSED", reasonMsg: null, nextOpenTime: open ? null : NOW + 3_600_000, nextCloseTime: null },
    tokenPrice: 200, referencePrice: 200, volume24H: 0, marketCap: 0,
  } as RwaToken;
}

const bscAllocation = {
  summary: "s",
  rationale: "r",
  riskScore: 6000,
  allocations: [
    { symbol: "NVDA", weightPct: 50, reason: "why", venue: "ondo" as const, address: NVDA_ONDO },
    { symbol: "BTCB", weightPct: 50, reason: "why" },
  ],
};

function req(chainKey: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/invest-plan", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-stax-chain": chainKey },
  });
}

beforeEach(() => {
  chainOverrides.clear();
  chainOverrides.set("bsc", bsc);
  chainOverrides.set("base", base);
  getSmartAccountMock.mockReset().mockResolvedValue({ address: ACCOUNT });
  readContractMock.mockReset().mockResolvedValue(usdToRaw(bsc, 1000)); // cash balance
  getCodeMock.mockReset().mockResolvedValue("0x6080");
  quoteMock.mockReset().mockImplementation(async (p: { amount: bigint }) => ({
    quoteId: "q", vendorName: "v", executionMode: "SWAP", fromTokenAmount: p.amount, toTokenAmount: BigInt(1000), priceImpactPercent: 0, approveTarget: ROUTER, raw: {},
  }));
  buildSwapMock.mockReset().mockResolvedValue({
    executionMode: "SWAP",
    tx: { from: EXECUTOR, to: ROUTER, data: "0xdeadbeef", value: "0", gas: "1", gasPrice: "1", minReceiveAmount: BigInt(990) },
  });
  rwaTokensMock.mockReset().mockResolvedValue([row(NVDA_B), row(NVDA_ONDO)]);
  catalogMock.mockReset().mockResolvedValue({ tickers: [nvdaTicker] });
  simulateMock.mockReset().mockResolvedValue({
    status: "SUCCESS",
    failReason: "",
    balanceChanges: [{ contractAddress: NVDA_ONDO, tokenType: "ERC20", change: "17887000000000000", owner: ACCOUNT }],
    allowanceChanges: [],
  });
  kyberRouteMock.mockReset();
  kyberBuildMock.mockReset();
  vi.mocked(signRiskInference).mockClear();
});

describe("POST /api/invest-plan on BNB Chain (executor live)", () => {
  it("returns a signed executor plan whose stock leg buys the issuer the plan showed — no direct calls", async () => {
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 12 }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as InvestPlanResult;
    expect(json.calls).toBeUndefined();
    expect(json.inference.signature).toBe(SIG);
    expect(json.executor).toBe(EXECUTOR);
    expect(json.usdcTotal).toBe(usdToRaw(bsc, 12).toString()); // no fee on BSC (ADR-0007)
    expect(json.legs.map((l) => l.tokenOut)).toEqual([NVDA_ONDO, assetBySymbol(bsc, "BTCB")!.address]);
    expect(json.legs.every((l) => l.router === ROUTER)).toBe(true);
    expect(quoteMock).toHaveBeenCalledWith(expect.objectContaining({ toToken: NVDA_ONDO, taker: EXECUTOR }));
  });

  it("dry-runs the exact batch the client sends — approve(USDT, executor, usdcTotal) then investWithAI — once, from the EntryPoint", async () => {
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 12 }));
    const json = (await res.json()) as InvestPlanResult;
    expect(simulateMock).toHaveBeenCalledTimes(1);
    const tx = simulateMock.mock.calls[0][0];
    expect(tx.from).toBe(entryPoint07Address);
    expect(tx.to).toBe(ACCOUNT);
    const batch = decodeFunctionData({
      abi: [{ type: "function", name: "executeBatch", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "dest", type: "address[]" }, { name: "value", type: "uint256[]" }, { name: "func", type: "bytes[]" }] }] as const,
      data: tx.data,
    });
    const [dest, , func] = batch.args;
    expect(dest.map((d) => d.toLowerCase())).toEqual([bsc.usdc.address.toLowerCase(), EXECUTOR.toLowerCase()]);
    const approve = decodeFunctionData({ abi: ERC20_ABI, data: func[0] });
    expect(approve.functionName).toBe("approve");
    expect([String(approve.args[0]).toLowerCase(), approve.args[1]]).toEqual([EXECUTOR.toLowerCase(), BigInt(json.usdcTotal)]);
    const invest = decodeFunctionData({ abi: STAX_EXECUTOR_ABI, data: func[1] });
    expect(invest.functionName).toBe("investWithAI");
    const [plan, inference, legs, usdcTotal] = invest.args as unknown as [{ planId: string }, { signature: string }, { tokenOut: string }[], bigint];
    expect(plan.planId).toBe(json.plan.planId);
    expect(inference.signature).toBe(SIG);
    expect(legs.map((l) => l.tokenOut.toLowerCase())).toEqual(json.legs.map((l) => l.tokenOut.toLowerCase()));
    expect(usdcTotal).toBe(BigInt(json.usdcTotal));
  });

  it("returns one dry run per leg, tagged with its symbol and token, in the shape PlanScreen reads", async () => {
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 12 }));
    const json = (await res.json()) as InvestPlanResult;
    expect(json.dryRuns!.map((d) => [d.status, d.symbol, d.token])).toEqual([
      ["passed", "NVDA", NVDA_ONDO],
      ["passed", "BTCB", assetBySymbol(bsc, "BTCB")!.address],
    ]);
    expect(json.dryRuns![0].receiveRaw).toBe("17887000000000000");
  });

  it("marks every leg skipped (never checked) for an account with no code yet", async () => {
    getCodeMock.mockResolvedValue("0x");
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 12 }));
    const json = (await res.json()) as InvestPlanResult;
    expect(res.status).toBe(200);
    expect(json.dryRuns!.every((d) => d.status === "skipped")).toBe(true);
    expect(simulateMock).not.toHaveBeenCalled();
  });

  it("refuses the whole plan with the direct path's closed message, before signing anything, when a stock leg is closed", async () => {
    rwaTokensMock.mockResolvedValue([row(NVDA_B, false), row(NVDA_ONDO, false)]);
    catalogMock.mockResolvedValue({ tickers: [{ ...nvdaTicker, bestVenue: null }] });
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 12 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^NVDA is closed right now/);
    expect(signRiskInference).not.toHaveBeenCalled();
    expect(quoteMock).not.toHaveBeenCalled();
    expect(simulateMock).not.toHaveBeenCalled();
  });

  it("words an under-$6 leg for a plan screen, not a trade's amount field", async () => {
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 10 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(PLAN_MIN_LEG_MESSAGE);
  });

  it("maps a 'route' refusal to a calm 502, never Binance's words", async () => {
    quoteMock.mockImplementation(async (p: { amount: bigint }) => ({
      quoteId: "q", vendorName: "v", executionMode: "RFQ", fromTokenAmount: p.amount, toTokenAmount: BigInt(1000), priceImpactPercent: 0, approveTarget: ROUTER, raw: {},
    }));
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 12 }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toMatch(/RFQ/);
  });

  it("only plans for the caller's own registered account (the dry run simulates from it)", async () => {
    const res = await POST(req("bsc", { address: "0x9999999999999999999999999999999999999999", allocation: bscAllocation, amountUsd: 12 }));
    expect(res.status).toBe(403);
    expect(signRiskInference).not.toHaveBeenCalled();
  });

  it("refuses a plan bigger than the cash in the account, in plan words", async () => {
    readContractMock.mockResolvedValue(usdToRaw(bsc, 5));
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 12 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/more than the \$5\.00 you have/);
  });

  it("keeps the direct smart-account path as the fallback for a Binance chain with no executor", async () => {
    chainOverrides.set("bsc", { ...bsc, contracts: { ...bsc.contracts, deployed: false } });
    const res = await POST(req("bsc", { address: ACCOUNT, allocation: bscAllocation, amountUsd: 12 }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as InvestPlanResult;
    expect(json.calls).toHaveLength(4); // [approve, swap] per leg
    expect(json.legs).toEqual([]);
    expect(signRiskInference).not.toHaveBeenCalled();
  });
});

describe("POST /api/invest-plan on Base (unchanged)", () => {
  const asset = base.assets.all.find((a) => a.address && !a.coming && a.via !== "aave_v3" && a.via !== "route")!;
  const allocation = { summary: "s", rationale: "r", riskScore: 5000, allocations: [{ symbol: asset.symbol, weightPct: 100, reason: "why" }] };

  it("returns the same executor plan shape as before: no account lookup, no Binance, no dryRuns", async () => {
    kyberRouteMock.mockResolvedValue({ routeSummary: {}, routerAddress: base.routers.kyber, amountOut: BigInt(1000) });
    // Kyber builds for exactly the leg's amount (buildKyberLeg checks it).
    kyberBuildMock.mockImplementation(async () => ({ amountIn: kyberRouteMock.mock.calls[0][1].amountIn, amountOut: BigInt(1000), data: "0xabcdef" }));
    const res = await POST(req("base", { address: ACCOUNT, allocation, amountUsd: 10 }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as InvestPlanResult;
    expect(Object.keys(json).sort()).toEqual(["chain", "executor", "explorer", "inference", "legs", "notes", "plan", "usdcTotal"]);
    expect(json.executor).toBe(BASE_EXECUTOR);
    expect(json.legs).toHaveLength(1);
    expect(json.legs[0].swapData).toBe("0xabcdef");
    expect(getSmartAccountMock).not.toHaveBeenCalled();
    expect(rwaTokensMock).not.toHaveBeenCalled();
    expect(catalogMock).not.toHaveBeenCalled();
    expect(simulateMock).not.toHaveBeenCalled();
    expect(readContractMock).not.toHaveBeenCalled();
  });
});
