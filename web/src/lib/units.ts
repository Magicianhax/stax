// Dollars <-> raw cash units for any chain. Cash is 6-decimal USDC on Base and Mantle and
// 18-decimal USDT on BSC, so a hardcoded "* 1_000_000" is a 10^12x bug on BSC. Every
// conversion goes through here: exact to the micro-dollar, and never a float times 1e18.
import type { StaxChain } from "./chains";

type Cash = Pick<StaxChain, "usdc">;

export function usdToRaw(chain: Cash, usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`usdToRaw: invalid amount ${usd}`);
  const micros = BigInt(Math.round(usd * 1e6));
  const d = chain.usdc.decimals;
  return d >= 6 ? micros * BigInt(10) ** BigInt(d - 6) : micros / BigInt(10) ** BigInt(6 - d);
}

/** For display only: loses precision above 2^53 raw units, which is fine for a label. */
export function rawToUsd(chain: Cash, raw: bigint): number {
  return Number(raw) / 10 ** chain.usdc.decimals;
}
