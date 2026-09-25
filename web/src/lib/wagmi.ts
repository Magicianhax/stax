// Multi-chain wagmi + viem wiring. Base (8453) is default; Mantle (5000) is the legacy mode;
// BSC (56) is the BNB Hack chain.
// Privy owns the embedded wallet + signing; wagmi here is read-only chain context.
// For chain-aware reads use `getPublicClient(chain)`.
import { createConfig } from "wagmi";
import { createPublicClient, type PublicClient } from "viem";
import { BASE, BSC, MANTLE, CHAINS, chainTransport, type ChainKey, type StaxChain } from "./chains";

export const base = BASE.chain;
export const mantle = MANTLE.chain;
export const bsc = BSC.chain;

export const wagmiConfig = createConfig({
  chains: [base, mantle, bsc],
  transports: {
    [base.id]: chainTransport(BASE),
    [mantle.id]: chainTransport(MANTLE),
    [bsc.id]: chainTransport(BSC),
  },
  ssr: true,
});

const clients = new Map<ChainKey, PublicClient>();

/**
 * Shared read-only client per chain. `batch.multicall` aggregates every readContract
 * issued in the same tick into ONE Multicall3 eth_call — a portfolio refresh or a quote
 * burst becomes a single RPC request (public RPC rate limiters demand this).
 */
export function getPublicClient(chain: StaxChain | ChainKey): PublicClient {
  const c = typeof chain === "string" ? CHAINS[chain] : chain;
  let client = clients.get(c.key);
  if (!client) {
    client = createPublicClient({
      chain: c.chain,
      batch: { multicall: { wait: 16 } },
      transport: chainTransport(c),
    }) as PublicClient;
    clients.set(c.key, client);
  }
  return client;
}

export type WagmiConfig = typeof wagmiConfig;
