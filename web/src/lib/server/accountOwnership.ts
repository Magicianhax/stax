import "server-only";

// Whose smart account an address is. One Privy login can link several wallets (the email wallet
// Privy makes, plus any wallet the person connects), and each owns its own smart account at a
// different address, while `smart_accounts` keeps one row per user per chain: whichever device
// registered last. 2026-10-09: $25 in Savings at the email wallet's account was refused ("Savings
// must be for your own account") because the person's other linked wallet had registered its
// account on BNB Chain a few hours later. An address is the person's own when it is the
// registered one, or the smart account of any wallet linked to the same login, derived from the
// account factory on chain.
import { parseAbi } from "viem";
import type { StaxChain } from "@/lib/chains/types";
import { serverClient } from "./chain";
import { fetchPrivyWallets } from "./privyAuth";
import { getSmartAccount } from "./users";

/**
 * permissionless's `toSimpleSmartAccount` factory for EntryPoint v0.7, the account lib/aa.ts
 * builds on every chain. Verified 2026-10-09: getAddress(owner, 0) returns both of a real user's
 * registered smart accounts from their two owners.
 */
export const SIMPLE_ACCOUNT_FACTORY_V07 = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985" as const;
const FACTORY_ABI = parseAbi(["function getAddress(address owner, uint256 salt) view returns (address)"]);

/**
 * "registered": the account /api/me/account last stored for this user and chain. "linked": the
 * account of another wallet on the same login. "unregistered": no row yet (a brand-new wallet).
 * "foreign": anyone else's.
 */
export type Ownership = "registered" | "linked" | "unregistered" | "foreign";

export interface OwnershipDeps {
  registered: (userId: string, chain: StaxChain) => Promise<string | null>;
  /** The EOAs linked to this login that can own a smart account (embedded and external wallets). */
  linkedOwners: (userId: string) => Promise<string[]>;
  accountFor: (chain: StaxChain, owner: `0x${string}`) => Promise<string>;
}

const defaultDeps: OwnershipDeps = {
  registered: async (userId, chain) => (await getSmartAccount(userId, chain.key))?.address ?? null,
  linkedOwners: async (userId) =>
    (await fetchPrivyWallets(userId)).filter((w) => w.kind === "embedded" || w.kind === "external").map((w) => w.address),
  accountFor: async (chain, owner) =>
    serverClient(chain).readContract({
      address: SIMPLE_ACCOUNT_FACTORY_V07,
      abi: FACTORY_ABI,
      functionName: "getAddress",
      args: [owner, BigInt(0)],
    }),
};

export async function smartAccountOwnership(
  userId: string,
  chain: StaxChain,
  address: string,
  deps: OwnershipDeps = defaultDeps,
): Promise<Ownership> {
  const want = address.toLowerCase();
  const registered = await deps.registered(userId, chain);
  if (!registered) return "unregistered";
  if (registered.toLowerCase() === want) return "registered";
  try {
    const owners = await deps.linkedOwners(userId);
    const accounts = await Promise.all(owners.map((o) => deps.accountFor(chain, o as `0x${string}`)));
    if (accounts.some((a) => a.toLowerCase() === want)) return "linked";
  } catch (err) {
    console.warn("[ownership] couldn't check linked wallets:", err instanceof Error ? err.message : err);
  }
  return "foreign";
}
