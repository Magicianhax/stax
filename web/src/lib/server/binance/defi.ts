import "server-only";

// The DeFi API, prefix /api/v1/defi (docs/BINANCE-WEB3.md's DeFi section, LIVE-verified
// 2026-09-25 for Venus's BSC USDT market — protocol/list and investment/list were the discovery
// calls that found `investmentId`; savings.ts pins that id and only ever calls investmentDetail /
// buildDeposit / buildRedeem against it, never re-discovers it per request). Only what Savings
// needs is wrapped here — the LP and claim endpoints have no caller yet.
import { z } from "zod";
import { web3Request } from "./client";
import { BinanceWeb3Error } from "./types";
import type { DefiInvestmentDetail } from "./types";
import type { ExecCall } from "@/lib/execution";

const wireToken = z.object({ tokenAddress: z.string(), tokenName: z.string(), tokenSymbol: z.string() });

const wireInvestmentDetail = z.object({
  investmentId: z.string(),
  defiProtocolId: z.string(),
  protocolName: z.string(),
  investmentName: z.string(),
  investType: z.string(),
  investable: z.boolean(),
  apyBps: z.number(),
  apyDisplay: z.string(),
  tvl: z.string(),
  assetTokenList: z.array(wireToken),
});

/** The current state of one DeFi investment product — Savings calls this for Venus's USDT market. */
export async function investmentDetail(investmentId: string): Promise<DefiInvestmentDetail> {
  const data = await web3Request<unknown>("POST", "/api/v1/defi/data/investment/detail", {}, { investmentId });
  const parsed = wireInvestmentDetail.safeParse(data);
  if (!parsed.success) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/defi/data/investment/detail", 200);
  }
  const d = parsed.data;
  const token = d.assetTokenList[0];
  return {
    investmentId: d.investmentId,
    defiProtocolId: d.defiProtocolId,
    protocolName: d.protocolName,
    investmentName: d.investmentName,
    investType: d.investType,
    investable: d.investable,
    apyBps: d.apyBps,
    apyDisplay: d.apyDisplay,
    tvl: Number(d.tvl),
    assetToken: token ? { address: token.tokenAddress as `0x${string}`, symbol: token.tokenSymbol } : null,
  };
}

// Binance's own `callDataType` order (LIVE: sometimes just [DEPOSIT] when the wallet already has
// an allowance, sometimes [APPROVE, DEPOSIT] per docs — see defi.test.ts for both shapes). Never
// assumed to be exactly N calls; every entry is carried through as-is, in order.
const wireTxLeg = z.object({
  callDataType: z.string(),
  to: z.string(),
  data: z.string(),
  value: z.string(), // hex ("0x0"), unlike ExecCall.value which is a decimal-string
});

const wireBuildResponse = z.object({ dataList: z.array(wireTxLeg) });

/** Binance sends `value` as hex; every other ExecCall producer in this codebase (bscPlan.ts,
 *  binanceLegs.ts) already uses a decimal-string wei, so this is the one place a DeFi build
 *  response's hex gets converted, not something callers have to remember. */
function toExecCalls(dataList: z.infer<typeof wireTxLeg>[]): ExecCall[] {
  return dataList.map((leg) => ({
    to: leg.to as `0x${string}`,
    data: leg.data as `0x${string}`,
    value: BigInt(leg.value).toString(),
  }));
}

/**
 * Unsigned calldata to deposit `amountHuman` (a human decimal string — Binance's own API, not
 * raw units; see lib/units.ts's doc comment on why cash conversions matter, which this
 * deliberately bypasses because it isn't one) of `tokenAddress` into `investmentId`.
 */
export async function buildDeposit(params: {
  address: `0x${string}`;
  investmentId: string;
  tokenAddress: `0x${string}`;
  amountHuman: string;
}): Promise<ExecCall[]> {
  const data = await web3Request<unknown>("POST", "/api/v1/defi/transaction/deposit", {}, {
    address: params.address,
    investmentId: params.investmentId,
    token: { tokenAddress: params.tokenAddress, amount: params.amountHuman },
  });
  const parsed = wireBuildResponse.safeParse(data);
  if (!parsed.success) throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/defi/transaction/deposit", 200);
  return toExecCalls(parsed.data.dataList);
}

/** Unsigned calldata to redeem `ratio` (0, 1] of the caller's position in `investmentId`. */
export async function buildRedeem(params: {
  address: `0x${string}`;
  investmentId: string;
  ratio: string;
}): Promise<ExecCall[]> {
  const data = await web3Request<unknown>("POST", "/api/v1/defi/transaction/redeem", {}, {
    address: params.address,
    investmentId: params.investmentId,
    ratio: params.ratio,
  });
  const parsed = wireBuildResponse.safeParse(data);
  if (!parsed.success) throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/defi/transaction/redeem", 200);
  return toExecCalls(parsed.data.dataList);
}
