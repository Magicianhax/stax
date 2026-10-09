import "server-only";

// Savings — Stax's name for one BSC lending product: Venus's USDT market, discovered LIVE
// through the Binance DeFi API (docs/BINANCE-WEB3.md's DeFi section, 2026-09-25) and pinned here
// rather than looked up per request, so a deposit or redeem can never be redirected to a
// different investment product by a Binance response.
//
// Review fix (wave 5b): `assertSavingsCallsAreSafe`'s address allowlist alone isn't the "same
// safety bar as buys" the brief asks for — it lets THROUGH any calldata Binance writes to an
// allowed address, approve included, which would also let through `USDT.approve(attacker, max)`
// or a `mint()` for a different amount than the user asked for. binanceLegs.ts never has this
// problem because it never trusts Binance for an approve at all: `directCallsForLeg` builds its
// own exact-amount approve and takes only the swap bytes from Binance. Savings now does the same:
// `pickDepositCall` below decodes every call Binance returns, drops any approve leg Binance wrote
// (an exact one is always rebuilt here instead, to the pinned Venus address, for an amount this
// module computed itself), and requires the one remaining call to be exactly vUSDT's `mint`, on
// vUSDT, carrying no native value. Anything else throws before `assertSavingsCallsAreSafe`'s
// address check ever runs — that check stays as a second, narrower layer, not as the only layer.
//
// Moving money out doesn't ask Binance at all (2026-10-09): its build-redeem answered 40456 "no
// position found" for a smart account holding $25 of vUSDT, because Binance's position index
// doesn't see it. The redeem is built here from the on-chain vUSDT balance instead.
import { decodeFunctionData, encodeFunctionData } from "viem";
import { ERC20_ABI } from "@/lib/abis";
import { usdToRaw } from "@/lib/units";
import { fromUnits } from "@/lib/format";
import { serverClient } from "@/lib/server/chain";
import { buildDeposit, investmentDetail } from "./binance/defi";
import { assertSavingsCallsAreSafe, VENUS_VUSDT_ADDRESS, type ExecCall } from "@/lib/execution";
import type { StaxChain } from "@/lib/chains/types";

/** The vUSDT surface Savings calls — never the full Compound/Venus ABI, so decoding something
 *  outside this narrow set (a borrow, a liquidation, anything) fails closed rather than matching
 *  by accident. Selectors are computed by viem from these signatures, not hardcoded hex, so
 *  there's nothing here to transcribe wrong; defi.test.ts's LIVE fixture independently pins
 *  mint's selector as 0xa0712d68 and redeem's as 0xdb006a75. */
const VTOKEN_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "mintAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "redeemTokens", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "redeemUnderlying", stateMutability: "nonpayable", inputs: [{ name: "redeemAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

function isZeroValue(call: ExecCall): boolean {
  return call.value === undefined || call.value === "0";
}

/** True only for calldata that decodes, byte for byte, as ERC20 `approve` — never a guess from
 *  the `to` address, since the whole point is that Binance's `to` can't be trusted either. */
function isErc20Approve(call: ExecCall): boolean {
  try {
    return decodeFunctionData({ abi: ERC20_ABI, data: call.data }).functionName === "approve";
  } catch {
    return false;
  }
}

/**
 * Venus's USDT Earn market on BSC (`investmentId`, from `POST /api/v1/defi/data/investment/list`
 * filtered to `defiProtocolId: "venus"`). LIVE-verified 2026-09-25: `investmentDetail` on this id
 * returns Venus/USDT/investable:true, and a build-deposit call for it targets the vUSDT address
 * `assertSavingsCallsAreSafe` pins. Not re-discovered per request — a hardcoded id is the whole
 * point of "Savings is one product," not a general DeFi product picker.
 */
export const VENUS_USDT_INVESTMENT_ID = "5b77bfd8d8f7c18e9ee0d8f331c4d78f56744eed8addbe2e9970c0ef37e763cb";

export interface SavingsRate {
  apyBps: number;
  /** Binance's own formatted string ("3.38%") — shown verbatim, never re-derived from apyBps. */
  apyDisplay: string;
}

/** A user-facing refusal (bad chain, bad amount, no position to redeem) — safe to show verbatim,
 *  same split as BinanceLegRefusal / AllocationRefusal elsewhere in lib/server. Never a 500. */
export class SavingsRefusal extends Error {}

const RATE_TTL_MS = 5 * 60_000;
let rateCache: { at: number; value: SavingsRate | null } | undefined;

/**
 * The current Venus USDT rate, cached 5 minutes (APY moves slowly; this is read on every
 * WalletScreen view). Never invents a number: any Binance failure, or Binance itself saying the
 * product isn't investable right now, returns `null` so the card shows "rate unavailable" once
 * the cache goes stale — not a frozen old figure and not a guess.
 */
export async function getSavingsRate(): Promise<SavingsRate | null> {
  if (rateCache && Date.now() - rateCache.at < RATE_TTL_MS) return rateCache.value;
  let value: SavingsRate | null;
  try {
    const detail = await investmentDetail(VENUS_USDT_INVESTMENT_ID);
    value = detail.investable ? { apyBps: detail.apyBps, apyDisplay: detail.apyDisplay } : null;
  } catch (err) {
    console.warn("[savings] rate unavailable:", err instanceof Error ? err.message : err);
    value = null;
  }
  rateCache = { at: Date.now(), value };
  return value;
}

/**
 * The vUSDT view functions Savings' balance display reads — never the deposit/redeem entry
 * points, so a balance read can't accidentally become a write surface.
 */
const VTOKEN_VIEW_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "exchangeRateStored", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

/**
 * Raw vUSDT -> raw underlying USDT, LIVE-verified 2026-09-25 against the real BSC contract
 * (docs/BINANCE-WEB3.md §5a): a direct RPC read of `0xfD5840…BC0255.exchangeRateStored()` returned
 * `265149227449423179440324562`; the market's own `transaction/deposit` preview (same doc) shows
 * 6 USDT minting 226.3005974 vUSDT, and `6e18 * exchangeRateStored / 1e18 ≈ 6.0007e18` reproduces
 * that — Compound's own documented scaling (the 8-vs-18 decimal difference between vUSDT and USDT
 * is already folded into the reported rate, not something this needs to adjust for separately).
 */
export function vUsdtRawToUnderlyingRaw(vTokenRaw: bigint, exchangeRateStoredRaw: bigint): bigint {
  return (vTokenRaw * exchangeRateStoredRaw) / BigInt(10) ** BigInt(18);
}

/** Swapped out in tests so nothing here makes a real RPC call — same shape as dryRun.ts's `DryRunDeps`. */
export interface SavingsBalanceDeps {
  vUsdtBalance: (chain: StaxChain, address: `0x${string}`) => Promise<bigint>;
  vUsdtExchangeRateStored: (chain: StaxChain) => Promise<bigint>;
}

async function onChainVUsdtBalance(chain: StaxChain, address: `0x${string}`): Promise<bigint> {
  return (await serverClient(chain).readContract({
    address: VENUS_VUSDT_ADDRESS,
    abi: VTOKEN_VIEW_ABI,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;
}

async function onChainVUsdtExchangeRateStored(chain: StaxChain): Promise<bigint> {
  return (await serverClient(chain).readContract({
    address: VENUS_VUSDT_ADDRESS,
    abi: VTOKEN_VIEW_ABI,
    functionName: "exchangeRateStored",
  })) as bigint;
}

const defaultSavingsBalanceDeps: SavingsBalanceDeps = {
  vUsdtBalance: onChainVUsdtBalance,
  vUsdtExchangeRateStored: onChainVUsdtExchangeRateStored,
};

/**
 * The caller's current Savings balance in dollars. Reads vUSDT's balance and the market's live
 * exchange rate straight from BSC (no Binance call, no cache — a plain view read, cheap enough
 * to run on every WalletScreen poll), converts with `vUsdtRawToUnderlyingRaw`, and returns `null`
 * off BSC, on any read failure, or when the wallet holds no vUSDT at all — so the card can show
 * "no savings yet" rather than inventing a "$0.00" that looks like a real, checked balance.
 *
 * Review fix (wave 5b): before this existed, nothing read the vUSDT balance at all — a deposit
 * looked like the money had simply vanished, since neither the Savings card nor the portfolio
 * total accounted for it.
 */
export async function getSavingsBalanceUsd(
  chain: StaxChain,
  address: `0x${string}`,
  deps: SavingsBalanceDeps = defaultSavingsBalanceDeps,
): Promise<number | null> {
  if (chain.key !== "bsc") return null;
  try {
    const [vRaw, rate] = await Promise.all([deps.vUsdtBalance(chain, address), deps.vUsdtExchangeRateStored(chain)]);
    if (vRaw <= BigInt(0)) return null;
    return fromUnits(vUsdtRawToUnderlyingRaw(vRaw, rate), chain.usdc.decimals);
  } catch (err) {
    console.warn("[savings] balance unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

function assertBscAndPositiveAmount(chain: StaxChain, amountUsd: number): void {
  if (chain.key !== "bsc") throw new SavingsRefusal("Savings is only available on BNB Chain right now.");
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new SavingsRefusal("Enter an amount first.");
}

/**
 * Binance's deposit build (defi.ts's buildDeposit) writes ALL of its own calldata, approve
 * included, and that's exactly what a buy never does (binanceLegs.ts's directCallsForLeg builds
 * its own approve and only takes swap bytes from Binance). So this drops every approve leg
 * Binance returned — regardless of what it targets — and requires exactly one call left over,
 * which must be vUSDT's own `mint(uint256)`, on vUSDT, no native value, for precisely `amountRaw`.
 * A transfer, a call to any other address, or a mismatched amount throws rather than reaching
 * `assertSavingsCallsAreSafe` at all.
 */
function pickDepositCall(calls: ExecCall[], amountRaw: bigint): ExecCall {
  const nonApprove = calls.filter((c) => !isErc20Approve(c));
  if (nonApprove.length !== 1) {
    throw new Error(`Savings: expected exactly one deposit call from Binance, got ${nonApprove.length}.`);
  }
  const call = nonApprove[0];
  if (call.to.toLowerCase() !== VENUS_VUSDT_ADDRESS.toLowerCase()) {
    throw new Error(`Savings: deposit call targeted ${call.to}, not the pinned Venus contract.`);
  }
  if (!isZeroValue(call)) {
    throw new Error("Savings: deposit call carried native value, which vUSDT's mint doesn't take.");
  }
  let decoded: ReturnType<typeof decodeFunctionData<typeof VTOKEN_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: VTOKEN_ABI, data: call.data });
  } catch {
    throw new Error("Savings: deposit calldata didn't decode as vUSDT's mint.");
  }
  if (decoded.functionName !== "mint" || decoded.args[0] !== amountRaw) {
    throw new Error("Savings: deposit calldata didn't mint the exact amount requested.");
  }
  return call;
}

/**
 * Unsigned calls to move `amountUsd` of BSC cash into Savings: an exact-amount approve this
 * module builds itself (never Binance's), then the one deposit call `pickDepositCall` verified,
 * checked against the Savings allowlist before returning. `amountUsd` is a human decimal for the
 * Binance request (matching its own DeFi API — see defi.ts's doc comment), but the amount checked
 * against the calldata is the raw 18-decimal figure from lib/units.ts, the same one every other
 * cash conversion in this codebase uses, so a $6 deposit can only ever mint against 6n*10n**18n.
 */
export async function buildSavingsDeposit(chain: StaxChain, address: `0x${string}`, amountUsd: number): Promise<ExecCall[]> {
  assertBscAndPositiveAmount(chain, amountUsd);
  const amountRaw = usdToRaw(chain, amountUsd);
  const calls = await buildDeposit({
    address,
    investmentId: VENUS_USDT_INVESTMENT_ID,
    tokenAddress: chain.usdc.address,
    amountHuman: String(amountUsd),
  });
  const depositCall = pickDepositCall(calls, amountRaw);
  const approveCall: ExecCall = {
    to: chain.usdc.address,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [VENUS_VUSDT_ADDRESS, amountRaw] }),
  };
  return assertSavingsCallsAreSafe(chain, [approveCall, depositCall]);
}

/** Swapped out in tests so nothing here makes a real RPC call. */
export interface SavingsRedeemDeps {
  vUsdtBalance: (chain: StaxChain, address: `0x${string}`) => Promise<bigint>;
  /** vUSDT `redeem(redeemTokens)` simulated as `address`: Venus's own error code, 0 on success. */
  simulateRedeem: (chain: StaxChain, address: `0x${string}`, redeemTokens: bigint) => Promise<bigint>;
}

async function onChainSimulateRedeem(chain: StaxChain, address: `0x${string}`, redeemTokens: bigint): Promise<bigint> {
  const { result } = await serverClient(chain).simulateContract({
    address: VENUS_VUSDT_ADDRESS,
    abi: VTOKEN_ABI,
    functionName: "redeem",
    args: [redeemTokens],
    account: address,
  });
  return result;
}

const defaultSavingsRedeemDeps: SavingsRedeemDeps = {
  vUsdtBalance: onChainVUsdtBalance,
  simulateRedeem: onChainSimulateRedeem,
};

/**
 * Unsigned calls to move `ratio` (0, 1] of the caller's Venus USDT position back to cash: one
 * `redeem(vTokens)` on the pinned vUSDT contract, sized from the vUSDT balance read on chain (all of
 * it when `ratio` is 1, so nothing is left behind), with no approve (Venus burns the caller's own
 * vTokens). Simulated as the caller first, because a Compound-style market reports some failures
 * (not enough cash in the market, say) as a non-zero return code rather than a revert, which would
 * otherwise land as a "successful" transaction that moved nothing.
 */
export async function buildSavingsRedeem(
  chain: StaxChain,
  address: `0x${string}`,
  ratio: number,
  deps: SavingsRedeemDeps = defaultSavingsRedeemDeps,
): Promise<ExecCall[]> {
  if (chain.key !== "bsc") throw new SavingsRefusal("Savings is only available on BNB Chain right now.");
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new SavingsRefusal("Enter how much to move out.");
  const balance = await deps.vUsdtBalance(chain, address);
  if (balance <= BigInt(0)) throw new SavingsRefusal("You don't have savings to move out yet.");
  const redeemTokens = ratio >= 1 ? balance : (balance * BigInt(Math.round(ratio * 10_000))) / BigInt(10_000);
  if (redeemTokens <= BigInt(0)) throw new SavingsRefusal("Enter how much to move out.");
  let code: bigint;
  try {
    code = await deps.simulateRedeem(chain, address, redeemTokens);
  } catch (err) {
    console.warn("[savings] redeem simulation reverted:", err instanceof Error ? err.message : err);
    throw new SavingsRefusal("Venus can't release your savings this minute. Try again shortly.");
  }
  if (code !== BigInt(0)) {
    console.warn(`[savings] redeem simulation returned Venus error code ${code}`);
    throw new SavingsRefusal("Venus can't release your savings this minute. Try again shortly.");
  }
  const call: ExecCall = {
    to: VENUS_VUSDT_ADDRESS,
    data: encodeFunctionData({ abi: VTOKEN_ABI, functionName: "redeem", args: [redeemTokens] }),
  };
  return assertSavingsCallsAreSafe(chain, [call]);
}
