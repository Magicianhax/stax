import "server-only";

// Users + smart accounts (Postgres). See docs/INFRA.md.
//   touchUser()          upsert the Privy user row; refreshes last_seen_at. Every row
//                        that references users.id (autopilots, smart_accounts, baskets)
//                        must be preceded by this — the routes that write those await it.
//   upsertSmartAccount() the ERC-4337 account the user trades from, per chain.
//   getSmartAccount()    read it back (used by /api/swap-quote to verify `sender`).
import { and, eq, sql } from "drizzle-orm";
import type { ChainKey } from "@/lib/chains";
import { db, smartAccounts, users, type SmartAccount } from "@/lib/db";

export async function touchUser(userId: string, email?: string | null): Promise<void> {
  await db
    .insert(users)
    .values({ id: userId, email: email ?? null })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        lastSeenAt: sql`now()`,
        // Keep a known email; never blank it out with an undefined.
        email: email ? email : sql`${users.email}`,
      },
    });
}

export async function getSmartAccount(userId: string, chain: ChainKey): Promise<SmartAccount | null> {
  const [row] = await db
    .select()
    .from(smartAccounts)
    .where(and(eq(smartAccounts.userId, userId), eq(smartAccounts.chain, chain)))
    .limit(1);
  return row ?? null;
}

export async function upsertSmartAccount(input: {
  userId: string;
  chain: ChainKey;
  owner: `0x${string}`;
  address: `0x${string}`;
}): Promise<void> {
  await db
    .insert(smartAccounts)
    .values({ userId: input.userId, chain: input.chain, owner: input.owner, address: input.address })
    .onConflictDoUpdate({
      target: [smartAccounts.userId, smartAccounts.chain],
      set: { owner: input.owner, address: input.address, updatedAt: sql`now()` },
    });
}
