import "server-only";

// Deposit-address store (Postgres) for "Receive from any network" — contract: docs/RECEIVE.md.
//   getOrCreateDepositAddress()  find-or-create one OPEN Relay address per
//                                (user, chain, originChainId, originCurrency); a repeat call returns
//                                the stored row without calling Relay. Base + Base USDC returns the
//                                user's own account and stores nothing.
//   findOwnedDepositAddress()    the row for an address IF it belongs to the caller (status route).
//
// Trust: `recipient` is never taken from the client — it is the caller's smart account
// (ownedAddresses().primary, else the stored smart_accounts row). On EVM origins `refundTo` is
// the caller's embedded Privy EOA; the client only supplies it for Solana/Tron/Bitcoin, where we
// can only shape-check it (Relay validates for real and rejects with a 4xx we turn into a 400).
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { ChainKey } from "@/lib/chains";
import { USDC_ADDR as BASE_USDC } from "@/lib/chains/base";
import { db, depositAddresses, type DepositAddressRow } from "@/lib/db";
import {
  isValidRefundAddress,
  VM_NETWORK_LABEL,
  type DepositAddressResponse,
  type ReceiveNetwork,
  type ReceiveToken,
  type ReceiveVm,
} from "@/lib/receive";
import { ownedAddresses, type OwnedResolver } from "@/lib/server/ownedAddresses";
import { fetchPrivyWallets, type PrivyWallet } from "@/lib/server/privyAuth";
import { curatedNetworks, relay, RelayRejected, sameCurrency, type RelayClient } from "@/lib/server/relay";
import { getSmartAccount, touchUser } from "@/lib/server/users";

const BASE_CHAIN_ID = 8453;
const MIN_USD_FLOOR = 5;

/** A 4xx the client may show verbatim. */
export class ReceiveInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiveInputError";
  }
}

export interface ReceiveDeps {
  owned: OwnedResolver;
  wallets: (userId: string) => Promise<PrivyWallet[]>;
  relay: RelayClient;
  /** Whether Relay calls carry an API key (gates Solana). Defaults to the env. */
  hasApiKey?: boolean;
}

const defaultDeps: ReceiveDeps = { owned: ownedAddresses, wallets: fetchPrivyWallets, relay };

const newId = () => randomBytes(9).toString("base64url");

// ---------- representative amount ----------

/** Rough USD prices for the majors — only used to size the representative quote (~$50). */
const ROUGH_PRICE_USD: Record<string, number> = {
  ETH: 2500,
  WETH: 2500,
  BTC: 100_000,
  SOL: 150,
  BNB: 600,
  TRX: 0.3,
  MNT: 1,
  AVAX: 30,
  POL: 0.4,
};
const QUOTE_USD = 50;

/** ≈ $50 of `token` in its smallest unit. Exactness does not matter for open addresses. */
export function representativeAmount(token: Pick<ReceiveToken, "symbol" | "decimals">): string {
  const price = ROUGH_PRICE_USD[token.symbol] ?? 1; // stables + unknowns count as $1
  const units = QUOTE_USD / price;
  // Scale with integer math so 18-decimal amounts stay exact.
  const scaled = Math.round(units * 1e6); // 6 decimals of precision on the unit count
  const amount = (BigInt(scaled) * BigInt(10) ** BigInt(token.decimals)) / BigInt(1_000_000);
  return (amount > BigInt(0) ? amount : BigInt(1)).toString();
}

/** "Send at least about $N": twice Relay's fee, whole dollars, never under $5. */
export function minUsdFor(feeUsd: number): number {
  return Math.max(MIN_USD_FLOOR, Math.ceil(feeUsd * 2));
}

// ---------- lookups ----------

function findRoute(
  networks: ReceiveNetwork[],
  originChainId: number,
  originCurrency: string,
): { network: ReceiveNetwork; token: ReceiveToken } | null {
  const network = networks.find((n) => n.id === originChainId);
  if (!network) return null;
  const token = network.tokens.find((t) => sameCurrency(network.vm, t.address, originCurrency));
  return token ? { network, token } : null;
}

/** Storage key for a currency: EVM addresses lowercased, everything else verbatim. */
const currencyKey = (vm: ReceiveVm, currency: string) => (vm === "evm" ? currency.toLowerCase() : currency);

async function recipientFor(userId: string, chain: ChainKey, deps: ReceiveDeps): Promise<string | null> {
  const primary = (await deps.owned(userId)).primary;
  if (primary) return primary;
  const row = await getSmartAccount(userId, chain);
  return row?.address.toLowerCase() ?? null;
}

function toResponse(row: DepositAddressRow): DepositAddressResponse {
  return {
    address: row.address,
    originChainId: row.originChainId,
    originCurrency: row.originCurrency,
    symbol: row.originSymbol,
    vm: row.originVm as ReceiveVm,
    minUsd: row.minUsd,
    feeUsd: Number(row.feeUsd),
    reusable: true,
    ownAddress: false,
  };
}

// ---------- public API ----------

export interface DepositAddressInput {
  userId: string;
  /** Destination chain — only 'base' bridges. */
  chain: ChainKey;
  originChainId: number;
  originCurrency: string;
  /** Only read for non-EVM origins. */
  refundTo?: string | null;
}

export async function getOrCreateDepositAddress(
  input: DepositAddressInput,
  deps: ReceiveDeps = defaultDeps,
): Promise<DepositAddressResponse> {
  if (input.chain !== "base") throw new ReceiveInputError("Receiving from other networks works on Base.");

  const networks = curatedNetworks(await deps.relay.getChains(), { hasApiKey: deps.hasApiKey });
  const route = findRoute(networks, input.originChainId, input.originCurrency);
  if (!route) throw new ReceiveInputError("That network or token isn't available.");
  const { network, token } = route;
  const originCurrency = currencyKey(network.vm, token.address);

  const recipient = await recipientFor(input.userId, input.chain, deps);
  if (!recipient) throw new ReceiveInputError("Open the app once so your account exists.");

  // Base USDC is the account itself — nothing to bridge, nothing to store.
  if (network.id === BASE_CHAIN_ID && sameCurrency("evm", token.address, BASE_USDC)) {
    return {
      address: recipient,
      originChainId: network.id,
      originCurrency,
      symbol: token.symbol,
      vm: "evm",
      minUsd: 0,
      feeUsd: 0,
      reusable: true,
      ownAddress: true,
    };
  }

  const routeWhere = and(
    eq(depositAddresses.userId, input.userId),
    eq(depositAddresses.chain, input.chain),
    eq(depositAddresses.originChainId, network.id),
    eq(depositAddresses.originCurrency, originCurrency),
  );
  const [existing] = await db.select().from(depositAddresses).where(routeWhere).limit(1);
  if (existing) {
    await db.update(depositAddresses).set({ lastSeenAt: sql`now()` }).where(eq(depositAddresses.id, existing.id));
    return toResponse(existing);
  }

  // Refund address on the ORIGIN chain.
  let refundTo: string;
  if (network.vm === "evm") {
    const embedded = (await deps.wallets(input.userId)).find((w) => w.kind === "embedded");
    if (!embedded) throw new ReceiveInputError("Open the app once so your account exists.");
    refundTo = embedded.address;
  } else {
    const given = input.refundTo?.trim() ?? "";
    if (!given || !isValidRefundAddress(network.vm, given)) {
      throw new ReceiveInputError(`Enter a valid ${VM_NETWORK_LABEL[network.vm]} address for refunds.`);
    }
    refundTo = given;
  }

  let quote;
  try {
    quote = await deps.relay.requestDepositAddress({
      originChainId: network.id,
      originCurrency: token.address,
      amount: representativeAmount(token),
      recipient,
      refundTo,
      destinationChainId: BASE_CHAIN_ID,
      destinationCurrency: BASE_USDC,
    });
  } catch (e) {
    // Relay's 4xx (bad refund address, blocked address, unsupported pair) is the user's to fix.
    if (e instanceof RelayRejected) {
      console.warn("[receive] relay rejected:", e.code, e.message);
      throw new ReceiveInputError(
        e.code === "BLOCKED_WALLET_ADDRESS"
          ? "That refund address can't be used."
          : /address/i.test(e.message)
            ? `Enter a valid ${VM_NETWORK_LABEL[network.vm]} address for refunds.`
            : "That network or token isn't available right now.",
      );
    }
    throw e;
  }

  await touchUser(input.userId);
  const feeUsd = Math.round(quote.feeUsd * 1e6) / 1e6;
  const [inserted] = await db
    .insert(depositAddresses)
    .values({
      id: newId(),
      userId: input.userId,
      chain: input.chain,
      recipient,
      originChainId: network.id,
      originCurrency,
      originSymbol: token.symbol,
      originVm: network.vm,
      refundTo,
      address: quote.address,
      requestId: quote.requestId,
      feeUsd: feeUsd.toString(),
      minUsd: minUsdFor(feeUsd),
    })
    // Two concurrent first calls: keep the row that won, drop this quote.
    .onConflictDoNothing({ target: [depositAddresses.userId, depositAddresses.chain, depositAddresses.originChainId, depositAddresses.originCurrency] })
    .returning();
  if (inserted) return toResponse(inserted);
  const [winner] = await db.select().from(depositAddresses).where(routeWhere).limit(1);
  if (!winner) throw new Error("deposit address insert raced and the winner is gone");
  return toResponse(winner);
}

/** The stored row for `address` when it belongs to `userId`; null otherwise (unknown or someone else's). */
export async function findOwnedDepositAddress(userId: string, address: string): Promise<DepositAddressRow | null> {
  const [row] = await db
    .select()
    .from(depositAddresses)
    .where(and(eq(depositAddresses.address, address), eq(depositAddresses.userId, userId)))
    .limit(1);
  return row ?? null;
}
