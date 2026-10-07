// Stax platform fee — a small flat fee on capital DEPLOYED (manual buys + AI
// invests). Taken as a gasless USDC transfer to the treasury, batched into the
// same sponsored UserOp as the trade, so the user signs once and pays no gas.
// Config-driven so it's tunable without a redeploy. Client-safe (NEXT_PUBLIC) so
// the client (batches the transfer) and the server (sizes legs to the net) agree.
//
// BSC is fee-free (ADR-0007): the hack's judged flow never sends `feePercent` /
// `feeSource` / a referrer wallet to Binance, and Stax skims nothing of its own
// on top. Every fee function below takes an optional chain key; every existing
// caller that passes nothing keeps today's behaviour unchanged (Base, Mantle).
import type { ChainKey } from "./chains/types";

const RAW_BPS = Number(process.env.NEXT_PUBLIC_STAX_FEE_BPS ?? "25"); // 0.25%
/** Platform fee in basis points (clamped 0–1000 = 0–10%). */
export const STAX_FEE_BPS = Number.isFinite(RAW_BPS) && RAW_BPS >= 0 && RAW_BPS <= 1000 ? Math.round(RAW_BPS) : 25;
/** Fee as a percent, e.g. 0.25. */
export const STAX_FEE_PCT = STAX_FEE_BPS / 100;
/** Display label in basis points, e.g. "25 bps". */
export const STAX_FEE_LABEL = `${STAX_FEE_BPS} bps`;
/** Treasury that receives the fee (override via env; defaults to the deployer). */
export const STAX_TREASURY = (process.env.NEXT_PUBLIC_STAX_TREASURY ||
  "0xc6D7709dD8bA53832bd578A88260f8b8E59Fb4C7") as `0x${string}`;

const BPS = BigInt(10_000);

/** Fee on a raw token amount (e.g. USDC 6dp). Zero on BSC (ADR-0007). */
export function feeOf(amountRaw: bigint, chainKey?: ChainKey): bigint {
  if (chainKey === "bsc" || STAX_FEE_BPS <= 0) return BigInt(0);
  return (amountRaw * BigInt(STAX_FEE_BPS)) / BPS;
}

/** The fee rate in basis points on a chain: zero on BSC (ADR-0007), the platform fee elsewhere. */
export function feeBpsFor(chainKey?: ChainKey): number {
  return chainKey === "bsc" ? 0 : Math.max(0, STAX_FEE_BPS);
}

/** Amount actually deployed after the fee. */
export function netOf(amountRaw: bigint, chainKey?: ChainKey): bigint {
  return amountRaw - feeOf(amountRaw, chainKey);
}

/** Fee in USD for a USD amount (display helper). Zero on BSC (ADR-0007). */
export function feeUsd(amountUsd: number, chainKey?: ChainKey): number {
  if (chainKey === "bsc") return 0;
  return (amountUsd * STAX_FEE_BPS) / 10_000;
}
