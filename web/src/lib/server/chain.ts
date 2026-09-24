// SERVER-ONLY. Resolve which StaxChain a request targets.
// Clients send `x-stax-chain: base|mantle` (authedFetch does this automatically) or `?chain=`.
// Unknown/missing → the default chain (BNB Chain).
import "server-only";
import type { NextRequest } from "next/server";
import { createPublicClient, type PublicClient } from "viem";
import { CHAIN_HEADER, DEFAULT_CHAIN_KEY, chainTransport, getChain, isChainKey, type ChainKey, type StaxChain } from "@/lib/chains";

export { CHAIN_HEADER };

export function chainKeyFromRequest(req: NextRequest | Request): ChainKey {
  const url = new URL(req.url);
  const q = url.searchParams.get("chain");
  if (isChainKey(q)) return q;
  const h = req.headers.get(CHAIN_HEADER);
  if (isChainKey(h)) return h;
  return DEFAULT_CHAIN_KEY;
}

export function chainFromRequest(req: NextRequest | Request): StaxChain {
  return getChain(chainKeyFromRequest(req));
}

const clients = new Map<ChainKey, PublicClient>();

/** Cached read-only viem client per chain with Multicall3 batching (one eth_call per burst). */
export function serverClient(chain: StaxChain): PublicClient {
  let c = clients.get(chain.key);
  if (!c) {
    c = createPublicClient({
      chain: chain.chain,
      transport: chainTransport(chain),
      batch: { multicall: { wait: 16 } },
    }) as PublicClient;
    clients.set(chain.key, c);
  }
  return c;
}
