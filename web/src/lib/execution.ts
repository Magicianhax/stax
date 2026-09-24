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
