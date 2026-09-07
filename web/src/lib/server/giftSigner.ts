import "server-only";

// SERVER-ONLY. Signs the EIP-712 claim attestation the TimelockGift contract checks.
//
// This key is the whole security model of claiming. The contract cannot know who owns
// an email address, so it delegates that one question to us: a signature over
// (giftId, to, deadline) means "Stax has checked, against the Privy user record, that
// the person asking owns the email this gift was addressed to, and their account is
// `to`". Anyone may then submit the transaction — the recipient's sponsored user op does.
//
// The `server-only` import is a build-time guard: if this module is ever pulled into a
// client bundle (which would leak GIFT_SIGNER_PRIVATE_KEY), the build fails loudly.
//
// IMPORTANT: never read the wall clock at module top level — `deadline` is an argument.
import { privateKeyToAccount } from "viem/accounts";
import type { StaxChain } from "@/lib/chains/types";

/** How long an attestation stays good. Long enough to send a user op, short enough that a leaked one is worthless. */
export const CLAIM_DEADLINE_SECONDS = 10 * 60;

export const CLAIM_TYPES = {
  Claim: [
    { name: "giftId", type: "bytes32" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** EIP-712 domain — MUST match the TimelockGift deployed on `chain` exactly. */
export function claimDomain(chain: StaxChain, giftContract: `0x${string}`) {
  return { name: "StaxGift", version: "1", chainId: chain.id, verifyingContract: giftContract } as const;
}

function giftAccount() {
  const pk = process.env.GIFT_SIGNER_PRIVATE_KEY;
  if (!pk) throw new Error("GIFT_SIGNER_PRIVATE_KEY is not configured.");
  return privateKeyToAccount(pk as `0x${string}`);
}

/** The address the deployed contract checks against. Deploy with GIFT_SIGNER_ADDRESS = this. */
export function giftSignerAddress(): `0x${string}` {
  return giftAccount().address;
}

/** True once the server can attest claims at all — routes turn false into a friendly 503. */
export const GIFT_SIGNER_CONFIGURED = Boolean(process.env.GIFT_SIGNER_PRIVATE_KEY);

/** Sign `Claim(giftId, to, deadline)` for `chain`'s TimelockGift. */
export async function signClaim(
  chain: StaxChain,
  giftContract: `0x${string}`,
  input: { giftId: `0x${string}`; to: `0x${string}`; deadline: bigint },
): Promise<`0x${string}`> {
  return giftAccount().signTypedData({
    domain: claimDomain(chain, giftContract),
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: { giftId: input.giftId, to: input.to, deadline: input.deadline },
  });
}
