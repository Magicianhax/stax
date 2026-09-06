import "server-only";

// Which addresses a Privy user actually controls — the ownership proof behind the
// waitlist (docs/BETA.md). A client-submitted address is never trusted on its own.
//
//   owned = Privy-linked wallets (embedded + external EOAs, Privy smart wallets)
//         ∪ the ERC-4337 SimpleAccount (v0.7, salt 0) derived for each of them —
//           the account lib/aa.ts / privySmartAccount.ts build, same address on every
//           chain for the same owner, so it is derived once on Base.
//   primary = the SimpleAccount of the first embedded wallet (what the app trades from),
//             else the first owned address, else null.
//
// Cached in-process per user for 5 minutes. Derivation failures throw (never cached):
// a wrong "not yours" answer is worse than a retry.
import { isAddress, type Address } from "viem";
import { getChain } from "@/lib/chains";
import { serverClient } from "@/lib/server/chain";
import { fetchPrivyWallets, type PrivyWallet } from "@/lib/server/privyAuth";

/** permissionless' default SimpleAccountFactory for EntryPoint v0.7 (toSimpleSmartAccount). */
export const SIMPLE_ACCOUNT_FACTORY_V07: Address = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985";
const SALT = BigInt(0);
const FACTORY_ABI = [
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export interface OwnedAddresses {
  /** Every address the user controls, lowercased. */
  all: Set<string>;
  /** The address the list should show for them, lowercased; null when Privy knows no wallet. */
  primary: string | null;
}

export type OwnedResolver = (userId: string) => Promise<OwnedAddresses>;

/** CREATE2 address of the v0.7 SimpleAccount whose owner is `owner` (salt 0), lowercased. */
export async function deriveSmartAccount(owner: Address): Promise<string> {
  const client = serverClient(getChain("base"));
  const address = await client.readContract({
    address: SIMPLE_ACCOUNT_FACTORY_V07,
    abi: FACTORY_ABI,
    functionName: "getAddress",
    args: [owner, SALT],
  });
  return address.toLowerCase();
}

/** Pure assembly from Privy's wallet list — exported for tests. */
export async function ownedFromWallets(
  wallets: PrivyWallet[],
  derive: (owner: Address) => Promise<string> = deriveSmartAccount,
): Promise<OwnedAddresses> {
  const all = new Set<string>();
  let primary: string | null = null;
  for (const w of wallets) {
    if (!isAddress(w.address)) continue;
    const eoa = w.address.toLowerCase();
    all.add(eoa);
    if (w.kind === "smart_wallet") continue; // already a contract account; nothing to derive
    const smart = await derive(w.address);
    all.add(smart);
    if (w.kind === "embedded" && !primary) primary = smart;
  }
  if (!primary) primary = all.values().next().value ?? null;
  return { all, primary };
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: OwnedAddresses }>();
const inFlight = new Map<string, Promise<OwnedAddresses>>();

export const ownedAddresses: OwnedResolver = async (userId) => {
  const hit = cache.get(userId);
  if (hit && hit.at + TTL_MS > Date.now()) return hit.value;
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const p = (async () => {
    const wallets = await fetchPrivyWallets(userId);
    const value = await ownedFromWallets(wallets);
    cache.set(userId, { at: Date.now(), value });
    return value;
  })().finally(() => inFlight.delete(userId));
  inFlight.set(userId, p);
  return p;
};
