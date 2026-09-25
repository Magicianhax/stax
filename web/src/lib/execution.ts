// The direct execution path (ADR-0005): on BSC before the executor is deployed, the server
// returns the exact calls for one user operation instead of an executor plan. The client
// sends them as-is, batched and sponsored, through lib/aa.ts.
import { investableAssets } from "./chains";
import type { StaxChain } from "./chains/types";

export interface ExecCall {
  to: `0x${string}`;
  data: `0x${string}`;
  /** Wei, as a decimal string, because bigint does not survive JSON. */
  value?: string;
}

/**
 * The direct path has no executor contract whitelisting the callee, so this is the only check
 * standing between an untrusted `/api/invest-plan` (or swap-quote) response and the client
 * blindly asking the wallet to sign it. Every call must target cash, a listed catalog asset
 * (the token a leg buys or sells), or the chain's configured aggregator router — anything else
 * is refused before the batch is ever sent.
 */
export function assertExecCallsAreSafe(chain: StaxChain, calls: ExecCall[]): ExecCall[] {
  const allowed = new Set<string>([chain.usdc.address.toLowerCase()]);
  if (chain.routers.binance) allowed.add(chain.routers.binance.toLowerCase());
  for (const asset of investableAssets(chain)) {
    if (asset.address) allowed.add(asset.address.toLowerCase());
  }
  for (const call of calls) {
    if (!allowed.has(call.to.toLowerCase())) {
      throw new Error(`A planned call targeted ${call.to}, which isn't cash, a listed asset, or a known router.`);
    }
  }
  return calls;
}

/**
 * Venus's vUSDT market on BSC — the only DeFi contract Savings (wave 5b "money" stream) may call.
 * Pinned from a LIVE Binance DeFi API discovery (docs/BINANCE-WEB3.md's DeFi section,
 * 2026-09-25): `investmentDetail`'s `assetTokenList` and a build-deposit call's own `to` /
 * `interactWith.address` all agree on this address for the USDT investment Savings uses.
 * Exported so savings.ts builds its own calls against the exact same constant this allowlist
 * checks against, instead of a second copy that could drift.
 */
export const VENUS_VUSDT_ADDRESS = "0xfD5840Cd36d94D7229439859C0112a4185BC0255" as const;

/**
 * `assertExecCallsAreSafe`'s counterpart for the DeFi deposit/redeem path: the same "nothing
 * stands between an untrusted server response and a blind wallet signature" problem, checked
 * against its OWN narrower list rather than folded into the trading allowlist above — a
 * compromised swap-quote response must never be able to call Venus, and a compromised savings
 * response must never be able to call the trading router, so the two lists stay separate even
 * though the pattern is identical.
 */
export function assertSavingsCallsAreSafe(chain: StaxChain, calls: ExecCall[]): ExecCall[] {
  const allowed = new Set<string>([chain.usdc.address.toLowerCase(), VENUS_VUSDT_ADDRESS.toLowerCase()]);
  for (const call of calls) {
    if (!allowed.has(call.to.toLowerCase())) {
      throw new Error(`A savings call targeted ${call.to}, which isn't cash or the pinned Venus contract.`);
    }
  }
  return calls;
}
