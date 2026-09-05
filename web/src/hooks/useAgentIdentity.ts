"use client";

// Reads the Stax agent's on-chain identity (IdentityRegistry + agentId) on the
// active chain as a trust signal. The reputation score and signer are read-only
// and best-effort; if a call reverts we still surface the agent id + registry.
//
// The signer is read from InferenceVerifier.agentSigner() on-chain (the
// authoritative source) rather than a hardcoded constant, so it stays correct
// even after the agent key is rotated. On a chain whose contracts aren't
// deployed yet we return the configured id/registry with no reads.
import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "@/lib/wagmi";
import { IDENTITY_REGISTRY_ABI, INFERENCE_VERIFIER_ABI } from "@/lib/abis";
import { useChain } from "@/lib/chains/active";

export interface AgentIdentity {
  agentId: bigint;
  registry: `0x${string}`;
  /** On-chain agent signer (InferenceVerifier.agentSigner). Undefined if the read fails. */
  signer?: `0x${string}`;
  reputationScore?: bigint;
}

export function useAgentIdentity() {
  const chain = useChain();
  const { registry, agentId, verifier, deployed } = chain.contracts;
  return useQuery({
    queryKey: ["agent-identity", chain.key],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AgentIdentity> => {
      if (!deployed) return { agentId, registry };
      const client = getPublicClient(chain);
      const [reputationScore, signer] = await Promise.all([
        client
          .readContract({
            address: registry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "reputationScore",
            args: [agentId],
          })
          .then((v) => v as bigint)
          .catch(() => undefined),
        client
          .readContract({
            address: verifier,
            abi: INFERENCE_VERIFIER_ABI,
            functionName: "agentSigner",
          })
          .then((v) => v as `0x${string}`)
          .catch(() => undefined),
      ]);
      return { agentId, registry, signer, reputationScore };
    },
  });
}
