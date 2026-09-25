// Receive — the client-safe half of docs/RECEIVE.md: the JSON shapes the Receive sheet and
// the server share, plus the per-VM refund-address patterns the sheet validates with before
// it asks the server. Works on whichever chain is active (Base's USDC or BSC's USDT is the
// destination cash asset); the shapes below don't hardcode either one. No server imports here.
//
// Timestamps are unix SECONDS (the app's convention, see lib/autopilot.ts).

/** Relay's VM families. `evm` shares one address format across every EVM chain. */
export type ReceiveVm = "evm" | "svm" | "tvm" | "bvm";

/** A token that can be sent to a deposit address on its network. */
export interface ReceiveToken {
  /** Relay's currency id on that chain: 0x… on EVM, mint on Solana, T… on Tron, the BTC placeholder on Bitcoin. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

/** One curated network, tokens already filtered + ordered. */
export interface ReceiveNetwork {
  /** Relay chain id (EVM chain id, or Relay's synthetic id for Solana/Tron/Bitcoin). */
  id: number;
  /** Relay's slug (`base`, `arbitrum`, `solana`, …). */
  key: string;
  /** Display name. */
  name: string;
  vm: ReceiveVm;
  tokens: ReceiveToken[];
}

/** `GET /api/receive/networks` */
export interface NetworksResponse {
  networks: ReceiveNetwork[];
}

/** `POST /api/receive/deposit-address` body. `refundTo` is only read for non-EVM origins. */
export interface DepositAddressRequest {
  originChainId: number;
  originCurrency: string;
  refundTo?: string;
}

/** `POST /api/receive/deposit-address` */
export interface DepositAddressResponse {
  /** Where to send `symbol` on that network. The user's own account when `ownAddress`. */
  address: string;
  originChainId: number;
  originCurrency: string;
  symbol: string;
  vm: ReceiveVm;
  /** "Send at least about $N" — covers the route's fee with margin (whole dollars, ≥ 5). */
  minUsd: number;
  /** Relay's fee on the representative quote, USD. 0 when `ownAddress`. */
  feeUsd: number;
  /** Open addresses accept any amount and stay valid for the same route. */
  reusable: true;
  /** The chain's own cash asset landing on the chain itself (Base + USDC, BSC + USDT):
   *  this is the account itself, nothing is bridged. */
  ownAddress: boolean;
}

export type DepositStatus = "pending" | "success" | "failure" | "refund";

/** One deposit seen at a deposit address (`GET /api/receive/status`). */
export interface DepositRow {
  /** Relay request id. */
  id: string;
  status: DepositStatus;
  /** USD value of what arrived at the deposit address; null until Relay has priced it. */
  amountUsd: number | null;
  /** Tx hash on the origin network. */
  originTx: string | null;
  /** Tx hash on Base. */
  destinationTx: string | null;
  /** Unix seconds. */
  createdAt: number;
}

/** `GET /api/receive/status?address=` */
export interface DepositStatusResponse {
  deposits: DepositRow[];
}

/**
 * Rough shape checks for a refund address per VM — enough to catch a pasted address from the
 * wrong network before the server (and Relay, which validates for real) sees it.
 */
export const REFUND_ADDRESS_PATTERNS: Record<ReceiveVm, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  /** base58, 32–44 chars. */
  svm: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  /** base58check starting with T, 34 chars. */
  tvm: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  /** bech32/bech32m (bc1…) or legacy base58 (1…/3…). */
  bvm: /^(bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,62}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
};

export function isValidRefundAddress(vm: ReceiveVm, address: string): boolean {
  return REFUND_ADDRESS_PATTERNS[vm].test(address.trim());
}

/** Human name of the VM's address format, for validation copy. */
export const VM_NETWORK_LABEL: Record<ReceiveVm, string> = {
  evm: "Ethereum-style",
  svm: "Solana",
  tvm: "Tron",
  bvm: "Bitcoin",
};
