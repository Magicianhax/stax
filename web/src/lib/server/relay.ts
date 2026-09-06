import "server-only";

// Relay (relay.link) client — SERVER ONLY. Powers "Receive from any network" (docs/RECEIVE.md):
//   getChains()               GET /chains, cached in-process for 1 h (one in-flight fetch).
//   curatedNetworks(chains)   the subset + order the sheet shows, tokens filtered to stables/majors.
//   requestDepositAddress()   POST /quote/v2 with useDepositAddress → an OPEN deposit address
//                             (any amount, reusable for the same route) + Relay's fee.
//   depositsFor(address)      GET /requests/v2?depositAddress= → recent deposits, statuses mapped.
//
// Verified against the public API on 2026-09-06 (no key): the deposit address is
// `steps[0].depositAddress`, the request id `steps[0].requestId` (= top-level `requestId`), fees
// in `fees.relayer.amountUsd` + `fees.gas.amountUsd`. `user` must be an ORIGIN-chain address
// (Tron rejects an EVM `user`), so we send `refundTo` as `user`. Solana deposit addresses need
// an API key (`UNAUTHORIZED: This request is missing an api key…`); set RELAY_API_KEY to enable
// them — without one `curatedNetworks` leaves Solana out rather than offer a network that fails.
// GET /requests/v2 is deprecated (retires 2026-11-24; v3 needs a key) — see docs/INFRA.md.
import type { DepositRow, DepositStatus, ReceiveNetwork, ReceiveToken, ReceiveVm } from "@/lib/receive";

const API_URL = (process.env.RELAY_API_URL || "https://api.relay.link").replace(/\/+$/, "");
const API_KEY = process.env.RELAY_API_KEY || "";
const TIMEOUT_MS = 10_000;
const CHAINS_TTL_MS = 60 * 60_000;

// ---------- errors ----------

/** Relay refused the request (4xx with a message) — the message is Relay's, log it, don't show it raw. */
export class RelayRejected extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
    this.name = "RelayRejected";
  }
}

/** Network trouble, timeout, 5xx, or a payload we could not read. */
export class RelayUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayUnavailable";
  }
}

// ---------- transport ----------

async function relayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init?.body) headers["content-type"] = "application/json";
  if (API_KEY) headers["x-api-key"] = API_KEY;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new RelayUnavailable(`Relay ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    if (res.ok) throw new RelayUnavailable(`Relay ${path}: unreadable response`);
  }
  if (!res.ok) {
    const body = (json ?? {}) as { message?: unknown; errorCode?: unknown; error?: unknown };
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    const code = typeof body.errorCode === "string" ? body.errorCode : null;
    if (res.status >= 500) throw new RelayUnavailable(`Relay ${path}: ${res.status} ${message}`);
    throw new RelayRejected(message, code, res.status);
  }
  return json as T;
}

// ---------- chains ----------

export interface RelayCurrency {
  id?: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export interface RelayChain {
  id: number;
  name: string;
  displayName: string;
  vmType: ReceiveVm | string;
  depositEnabled: boolean;
  disabled?: boolean;
  currency?: RelayCurrency;
  solverCurrencies?: RelayCurrency[];
}

let chainsCache: { at: number; value: RelayChain[] } | null = null;
let chainsInFlight: Promise<RelayChain[]> | null = null;

/** Relay's chain list, cached in-process for 1 h. A stale copy is served if a refresh fails. */
export async function getChains(): Promise<RelayChain[]> {
  if (chainsCache && chainsCache.at + CHAINS_TTL_MS > Date.now()) return chainsCache.value;
  if (chainsInFlight) return chainsInFlight;
  chainsInFlight = (async () => {
    try {
      const body = await relayFetch<{ chains?: RelayChain[] }>("/chains");
      if (!Array.isArray(body.chains)) throw new RelayUnavailable("Relay /chains: no chains[]");
      chainsCache = { at: Date.now(), value: body.chains };
      return body.chains;
    } catch (e) {
      if (chainsCache) return chainsCache.value; // stale beats down
      throw e;
    } finally {
      chainsInFlight = null;
    }
  })();
  return chainsInFlight;
}

// ---------- curation ----------

/** Relay chain ids, in the order the sheet shows them (docs/RECEIVE.md). */
export const CURATED_CHAIN_IDS = [
  8453, // Base
  1, // Ethereum
  42161, // Arbitrum
  10, // Optimism
  137, // Polygon
  56, // BNB Chain
  43114, // Avalanche
  5000, // Mantle
  792703809, // Solana
  728126428, // Tron
  8253038, // Bitcoin
] as const;

const DISPLAY_NAME: Record<number, string> = { 56: "BNB Chain" };
const STABLES = new Set(["USDC", "USDT"]);
/** Token order within a network: stables first, then the native coin, then wrapped ETH. */
const SYMBOL_RANK = ["USDC", "USDT", "ETH", "SOL", "BNB", "TRX", "BTC", "WETH"];

const isVm = (v: string): v is ReceiveVm => v === "evm" || v === "svm" || v === "tvm" || v === "bvm";

/** Stable/major tokens only: USDC, USDT, the chain's native coin, and ETH/WETH on EVM chains. */
function keepToken(chain: RelayChain, c: RelayCurrency): boolean {
  if (STABLES.has(c.symbol)) return true;
  if (chain.currency && c.symbol === chain.currency.symbol) return true;
  if (chain.vmType === "evm" && (c.symbol === "ETH" || c.symbol === "WETH")) return true;
  return false;
}

/**
 * The curated, ordered network list served by `GET /api/receive/networks`. Only
 * `depositEnabled` chains with at least one kept solver currency make it in. Solana is
 * skipped without RELAY_API_KEY (its deposit addresses are key-gated upstream).
 */
export function curatedNetworks(chains: RelayChain[], opts: { hasApiKey?: boolean } = {}): ReceiveNetwork[] {
  const hasApiKey = opts.hasApiKey ?? Boolean(API_KEY);
  const byId = new Map(chains.map((c) => [c.id, c]));
  const out: ReceiveNetwork[] = [];
  for (const id of CURATED_CHAIN_IDS) {
    const chain = byId.get(id);
    if (!chain || !chain.depositEnabled || chain.disabled || !isVm(chain.vmType)) continue;
    if (chain.vmType === "svm" && !hasApiKey) continue;
    const seen = new Set<string>();
    const tokens: ReceiveToken[] = [];
    for (const c of chain.solverCurrencies ?? []) {
      if (!keepToken(chain, c) || seen.has(c.symbol)) continue;
      seen.add(c.symbol);
      tokens.push({ address: c.address, symbol: c.symbol, name: c.name, decimals: c.decimals });
    }
    if (!tokens.length) continue;
    tokens.sort((a, b) => rank(a.symbol) - rank(b.symbol));
    out.push({ id: chain.id, key: chain.name, name: DISPLAY_NAME[id] ?? chain.displayName, vm: chain.vmType, tokens });
  }
  return out;
}

function rank(symbol: string): number {
  const i = SYMBOL_RANK.indexOf(symbol);
  return i === -1 ? SYMBOL_RANK.length : i;
}

/** Compare currency ids the way Relay does: EVM addresses are case-insensitive, the rest exact. */
export function sameCurrency(vm: ReceiveVm, a: string, b: string): boolean {
  return vm === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// ---------- deposit address ----------

export interface DepositAddressParams {
  originChainId: number;
  originCurrency: string;
  /** Origin-chain units, as a decimal string. Representative only — open addresses take any amount. */
  amount: string;
  /** Destination (Base) account that receives USDC. */
  recipient: string;
  /** Origin-chain address refunds go to; also sent as Relay's `user`. */
  refundTo: string;
  destinationChainId: number;
  destinationCurrency: string;
}

export interface DepositAddressQuote {
  address: string;
  requestId: string;
  /** Relay's fee (relayer + gas) on the representative amount, USD. */
  feeUsd: number;
  /** Relay's fill estimate, seconds. */
  etaSeconds: number | null;
}

interface QuoteFee {
  amountUsd?: string;
}
interface QuoteResponse {
  requestId?: string;
  steps?: Array<{ id?: string; requestId?: string; depositAddress?: string }>;
  fees?: { relayer?: QuoteFee; gas?: QuoteFee };
  details?: { timeEstimate?: number };
}

const num = (v: unknown): number => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** One open deposit address for `originCurrency` on `originChainId` → USDC on Base for `recipient`. */
export async function requestDepositAddress(p: DepositAddressParams): Promise<DepositAddressQuote> {
  const body = {
    user: p.refundTo,
    originChainId: p.originChainId,
    originCurrency: p.originCurrency,
    destinationChainId: p.destinationChainId,
    destinationCurrency: p.destinationCurrency,
    amount: p.amount,
    recipient: p.recipient,
    tradeType: "EXACT_INPUT",
    refundTo: p.refundTo,
    useDepositAddress: true,
  };
  const q = await relayFetch<QuoteResponse>("/quote/v2", { method: "POST", body: JSON.stringify(body) });
  const step = q.steps?.find((s) => s.depositAddress) ?? q.steps?.[0];
  const address = step?.depositAddress;
  const requestId = step?.requestId ?? q.requestId;
  if (!address || !requestId) throw new RelayUnavailable("Relay /quote/v2: no depositAddress in steps[]");
  const feeUsd = num(q.fees?.relayer?.amountUsd) + num(q.fees?.gas?.amountUsd);
  const eta = q.details?.timeEstimate;
  return { address, requestId, feeUsd, etaSeconds: typeof eta === "number" ? eta : null };
}

// ---------- status ----------

interface RequestTx {
  hash?: string;
  txHash?: string;
  chainId?: number;
}
interface RelayRequest {
  id: string;
  status: string;
  createdAt?: string;
  data?: {
    inTxs?: RequestTx[];
    outTxs?: RequestTx[];
    metadata?: { currencyIn?: { amountUsd?: string }; currencyOut?: { amountUsd?: string } };
  };
}

/** Relay's status vocabulary (v2 filters + v3 additions) → the four the sheet shows. */
export function mapStatus(s: string): DepositStatus {
  switch (s) {
    case "success":
      return "success";
    case "failure":
    case "failed":
      return "failure";
    case "refund":
    case "refunded":
      return "refund";
    default: // pending | waiting | depositing | submitted | unknown
      return "pending";
  }
}

function txHash(t: RequestTx | undefined): string | null {
  const h = t?.txHash ?? t?.hash;
  return typeof h === "string" && h ? h : null;
}

/** Recent deposits at a deposit address, newest first (max 20). Empty when Relay has seen none. */
export async function depositsFor(address: string): Promise<DepositRow[]> {
  const qs = new URLSearchParams({ depositAddress: address, sortBy: "updatedAt", sortDirection: "desc", limit: "20" });
  const body = await relayFetch<{ requests?: RelayRequest[] }>(`/requests/v2?${qs}`);
  const rows = Array.isArray(body.requests) ? body.requests : [];
  return rows
    .filter((r) => typeof r.id === "string")
    .map((r) => {
      const usd = r.data?.metadata?.currencyIn?.amountUsd ?? r.data?.metadata?.currencyOut?.amountUsd;
      const created = r.createdAt ? Date.parse(r.createdAt) : NaN;
      return {
        id: r.id,
        status: mapStatus(String(r.status ?? "")),
        amountUsd: usd !== undefined && Number.isFinite(Number(usd)) ? Number(usd) : null,
        originTx: txHash(r.data?.inTxs?.[0]),
        destinationTx: txHash(r.data?.outTxs?.[0]),
        createdAt: Number.isFinite(created) ? Math.floor(created / 1000) : Math.floor(Date.now() / 1000),
      };
    });
}

/** The pieces of this module `depositAddresses.ts` depends on — swappable in the smoke test. */
export interface RelayClient {
  getChains: typeof getChains;
  requestDepositAddress: typeof requestDepositAddress;
}
export const relay: RelayClient = { getChains, requestDepositAddress };
