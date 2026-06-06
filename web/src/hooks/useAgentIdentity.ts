"use client";

// Reads the Stax agent's on-chain identity (IdentityRegistry, agentId 1) as a
// trust signal. The reputation score and signer are read-only and best-effort;
// if a call reverts we still surface the verified agent id + registry.
//
// The signer is read from InferenceVerifier.agentSigner() on-chain (the
// authoritative source) rather than a hardcoded constant, so it stays correct
// even after the agent key is rotated.
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "@/lib/wagmi";
import { IDENTITY_REGISTRY_ABI, INFERENCE_VERIFIER_ABI } from "@/lib/abis";
import { INFERENCE_VERIFIER } from "@/lib/mantle";

const IDENTITY_REGISTRY = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ||
  "0x9f147a87f131408dd0bd750c16ac782620572abf") as `0x${string}`;
const AGENT_ID = BigInt(process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1");

export interface AgentIdentity {
  agentId: bigint;
  registry: `0x${string}`;
  /** On-chain agent signer (InferenceVerifier.agentSigner). Undefined if the read fails. */
  signer?: `0x${string}`;
  reputationScore?: bigint;
}

export function useAgentIdentity() {
  return useQuery({
    queryKey: ["agent-identity"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AgentIdentity> => {
      const [reputationScore, signer] = await Promise.all([
        publicClient
          .readContract({
            address: IDENTITY_REGISTRY,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "reputationScore",
            args: [AGENT_ID],
          })
          .then((v) => v as bigint)
          .catch(() => undefined),
        publicClient
          .readContract({
            address: INFERENCE_VERIFIER,
            abi: INFERENCE_VERIFIER_ABI,
            functionName: "agentSigner",
          })
          .then((v) => v as `0x${string}`)
          .catch(() => undefined),
      ]);
      return { agentId: AGENT_ID, registry: IDENTITY_REGISTRY, signer, reputationScore };
    },
  });
}
