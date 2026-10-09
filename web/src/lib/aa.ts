"use client";

// Gasless ERC-4337 account abstraction for Stax (multi-chain).
//
// Flow: Privy gives us an embedded EOA (EIP-1193 provider) -> we make it the
// OWNER of a SimpleSmartAccount -> we send batched UserOperations through the
// Pimlico bundler, with gas sponsored by the Pimlico paymaster. The Pimlico API
// key never reaches the browser: both bundler and paymaster RPC go through our
// /api/pimlico proxy route (`?chain=` selects the network server-side).
//
// Public surface:
//   getSmartAccountClient(provider, chain) -> SmartAccountClient (cached per owner + chain)
//   sendSponsoredCalls(provider, calls, chain) -> user-op receipt (waits for inclusion)
//
// `provider` is obtained in components via Privy:
//   const { wallets } = useWallets();
//   const provider = await wallets[0].getEthereumProvider();
// `chain` is the active StaxChain (`useChain()` in components, `getActiveChain()`
// in plain modules). The SimpleAccount address is the same on every chain for the
// same owner + salt, but the client (bundler, paymaster, public client) is per chain.
import { custom, numberToHex, type Address, type EIP1193Provider, type Hex } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { tagUserOps } from "./builderCode";
import { getPublicClient } from "./wagmi";
import { authHeader, chainHeader } from "./authedFetch";
import type { ChainKey, StaxChain } from "./chains";
import { getActiveChain } from "./chains/active";

/** A single contract call to batch into a UserOperation. */
export interface Call {
  to: Address;
  data: Hex;
  value?: bigint;
}

// Same-origin proxy that injects PIMLICO_API_KEY server-side (see api/pimlico/route.ts).
const BUNDLER_URL = "/api/pimlico";

const ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const;

// callGasLimit padding over the bundler's estimate (see sendSponsoredCalls).
const BPS = BigInt(10_000);
const CALL_GAS_PAD_BPS = BigInt(15_000); // +50%

/**
 * Ask the owner wallet to point at `chain` before we build. Privy's embedded
 * wallet switches silently; an injected wallet may prompt. Unsupported or
 * declined switches are ignored — SimpleAccount signs a chain-agnostic
 * `personal_sign` of the user-op hash, so the send still works.
 */
async function ensureWalletChain(provider: EIP1193Provider, chain: StaxChain) {
  try {
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (Number(current) === chain.id) return;
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: numberToHex(chain.id) }],
    });
  } catch {
    /* unsupported / declined — see note above */
  }
}

async function buildClient(provider: EIP1193Provider, chain: StaxChain) {
  await ensureWalletChain(provider, chain);

  const bundlerUrl = `${BUNDLER_URL}?chain=${chain.key}`;
  // Pimlico client serves BOTH paymaster sponsorship and user-op gas pricing,
  // through our same-origin proxy (transport target = /api/pimlico?chain=…).
  const pimlico = createPimlicoClient({
    chain: chain.chain,
    transport: custom(rpcProvider(bundlerUrl)),
    entryPoint: ENTRY_POINT,
  });

  // The Privy embedded EOA (EIP-1193) is the OWNER/signer of the smart account.
  const account = await toSimpleSmartAccount({
    client: getPublicClient(chain),
    owner: provider,
    entryPoint: ENTRY_POINT,
  });
  // ERC-8021: credit Stax for the volume it sends (see builderCode.ts).
  tagUserOps(account, chain.key);
  const owner = account.address;

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: chain.chain,
    bundlerTransport: custom(rpcProvider(bundlerUrl)),
    // `true` is not enough when the paymaster lives behind a proxy; wire the
    // sponsorship calls explicitly to the Pimlico client.
    paymaster: pimlico,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
    },
  });

  return { owner: owner as Address, account, smartAccountClient, chain };
}

type Built = Awaited<ReturnType<typeof buildClient>>;

// Build once per (provider, chain) and dedupe concurrent builds so repeated
// invests reuse the same account + bundler wiring instead of re-deriving the
// smart account on every call. A chain switch simply builds a second entry.
const cache = new Map<ChainKey, WeakMap<EIP1193Provider, Promise<Built>>>();

/** Get (or build + cache) the smart-account client for a Privy provider on `chain`. */
export function getSmartAccountClient(provider: EIP1193Provider, chain: StaxChain = getActiveChain()) {
  let perChain = cache.get(chain.key);
  if (!perChain) {
    perChain = new WeakMap();
    cache.set(chain.key, perChain);
  }
  const existing = perChain.get(provider);
  if (existing) return existing;
  const built = buildClient(provider, chain).catch((e) => {
    perChain.delete(provider); // don't pin a failed build
    throw e;
  });
  perChain.set(provider, built);
  return built;
}

/** The bundler refused the user op in its simulation, so it was never sent and nothing moved. */
export const NOT_SENT_MESSAGE = "This didn't go through, and no money moved. Try again in a moment.";
/** The user op ran and reverted. A batch is atomic, so nothing in it moved either. */
export const REVERTED_MESSAGE = "This didn't go through on the network, so no money moved. Try again in a moment.";

/**
 * A sponsored user op that failed before or on chain. `message` is written for the person (the
 * raw bundler error is a wall of calldata hex); `detail` keeps what went wrong for the console.
 */
export class SponsoredCallError extends Error {
  constructor(
    message: string,
    readonly detail: unknown,
    readonly txHash?: `0x${string}`,
  ) {
    super(message);
    this.name = "SponsoredCallError";
  }
}

/** The person said no in the wallet: their own words stand, there is nothing to re-word. */
function isUserRejection(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null;
  return err?.code === 4001 || /user rejected|user denied|rejected the request/i.test(String(err?.message ?? ""));
}

/**
 * Send a batched, gas-sponsored UserOperation on `chain` and wait for it to be mined.
 * Example calls: [approve USDC -> executor, executor.investWithAI(...)].
 * Returns the user-operation receipt (includes the on-chain tx hash + status).
 */
export async function sendSponsoredCalls(
  provider: EIP1193Provider,
  calls: Call[],
  chain: StaxChain = getActiveChain(),
) {
  if (calls.length === 0) throw new Error("sendSponsoredCalls: no calls provided.");

  const { smartAccountClient, account } = await getSmartAccountClient(provider, chain);
  const ops = calls.map((c) => ({ to: c.to, data: c.data, value: c.value ?? BigInt(0) }));

  // Estimate first, then send with a padded callGasLimit. The bundler's estimate
  // is a simulation at the current state; aggregator routes (Kyber through
  // Uniswap v4 / Aerodrome) can need noticeably more gas a block later, and an
  // out-of-gas inside the router surfaces as a reverted op ("Call failed") that
  // still costs the sponsor. The paymaster pays actual gas, not the limit, so
  // the padding is free when unused. Fees + paymaster data are re-derived for
  // the padded limits by `sendUserOperation` itself.
  let userOpHash: Hex;
  try {
    const prepared = await smartAccountClient.prepareUserOperation({ account, calls: ops });
    userOpHash = await smartAccountClient.sendUserOperation({
      account,
      calls: ops,
      callGasLimit: (prepared.callGasLimit * CALL_GAS_PAD_BPS) / BPS,
      verificationGasLimit: prepared.verificationGasLimit,
      preVerificationGas: prepared.preVerificationGas,
      paymasterVerificationGasLimit: prepared.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: prepared.paymasterPostOpGasLimit,
      maxFeePerGas: prepared.maxFeePerGas,
      maxPriorityFeePerGas: prepared.maxPriorityFeePerGas,
    });
  } catch (e) {
    if (isUserRejection(e)) throw e;
    console.error("[aa] user operation not sent", e);
    throw new SponsoredCallError(NOT_SENT_MESSAGE, e);
  }

  const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash: userOpHash });
  if (!receipt.success) {
    const txHash = receipt.receipt.transactionHash;
    console.error(`[aa] user operation reverted, tx ${txHash}`);
    throw new SponsoredCallError(REVERTED_MESSAGE, receipt.reason, txHash);
  }
  return receipt;
}

// --- internals -------------------------------------------------------------

// A minimal EIP-1193-shaped provider over an HTTP JSON-RPC endpoint, so we can
// reuse viem's `custom()` transport for the same-origin Pimlico proxy.
function rpcProvider(url: string): EIP1193Provider {
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      const res = await fetch(url, {
        method: "POST",
        // Carry the Privy session token so the /api/pimlico proxy can authorize
        // the caller (the proxy rejects anonymous/unknown-method requests), plus
        // the chain header (belt and braces next to the `?chain=` query).
        headers: { "content-type": "application/json", ...chainHeader(), ...(await authHeader()) },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] }),
      });
      const json = await res.json();
      if (json.error) {
        const e = json.error;
        throw new Error(e?.message ? `${e.message}` : "Bundler RPC error");
      }
      return json.result;
    },
  } as unknown as EIP1193Provider;
}
