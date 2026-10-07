// Pure helpers over a user's Privy-managed wallets, kept apart from privyAuth.ts (which talks to
// Privy) so the ownership rule is a plain test.
export interface PrivyEmbeddedWallet {
  /** Privy wallet id: what the server signs with. */
  id: string;
  address: string;
}

/** Is this (walletId, owner) pair one of the caller's own embedded wallets? */
export function ownsEmbeddedWallet(wallets: readonly PrivyEmbeddedWallet[], walletId: string, owner: string): boolean {
  return wallets.some((w) => w.id === walletId && w.address.toLowerCase() === owner.toLowerCase());
}
