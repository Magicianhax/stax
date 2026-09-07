import "server-only";

// Zerion as the wallet-history source on Base (docs/INFRA.md, "Wallet history").
//
// Zerion already indexes this, so Stax does not: it returns a wallet's operations
// with each one already broken into fungible transfers carrying symbol, decimals
// and the counterparty — the shape `WalletTx` wants. One transfer becomes one
// `WalletTx`, so a trade yields several rows, which is what the Wallet screen and
// the cost-basis grouping in positions.ts both expect.
//
//   GET https://api.zerion.io/v1/wallets/<address>/transactions/?filter[chain_ids]=base&page[size]=100
//   Authorization: Basic base64("<key>:")        ← the key is the username, empty password
//
// NO `filter[operation_types]`, deliberately. Verified against this wallet on
// 2026-09-08: filtering to `trade,send,receive` drops every `execute` operation,
// and on Base that is where the Aave supply and several buys live — the wallet's
// aBasUSDC position and its platform-fee transfers would simply vanish.
//
// Everything below treats the payload as untrusted: every field is optional, a
// transfer we cannot map is skipped rather than guessed at, and no parse throws.
import { formatUnits } from "viem";
import type { ChainKey, StaxChain } from "@/lib/chains/types";
import type { WalletTx } from "@/lib/walletTx";

const ZERION_KEY = process.env.ZERION_API_KEY;
const BASE_URL = "https://api.zerion.io/v1";
const PAGE_SIZE = 100;
/** Pages followed while filling one request, so a deep wallet cannot run away. */
const MAX_PAGES = 5;
const TIMEOUT_MS = 12_000;

/**
 * Zerion's chain slug per Stax chain. Base only, on purpose: Etherscan V2 is the
 * source of record on Mantle and works, so an unverified mapping does not go in
 * front of a working one.
 */
const ZERION_CHAIN: Partial<Record<ChainKey, string>> = { base: "base" };

export function zerionSupports(chain: StaxChain): boolean {
  return Boolean(ZERION_KEY && ZERION_CHAIN[chain.key]);
}

// ── payload shapes (every field optional — this is someone else's JSON) ────────
interface ZImplementation {
  chain_id?: unknown;
  address?: unknown;
  decimals?: unknown;
}
interface ZFungible {
  symbol?: unknown;
  implementations?: unknown;
}
interface ZQuantity {
  int?: unknown;
  decimals?: unknown;
  float?: unknown;
  numeric?: unknown;
}
export interface ZTransfer {
  fungible_info?: ZFungible | null;
  nft_info?: unknown;
  direction?: unknown;
  quantity?: ZQuantity | null;
  /** USD value, or null when Zerion has no price (an aToken, a fresh listing). Never relied on. */
  value?: unknown;
  sender?: unknown;
  recipient?: unknown;
}
export interface ZTransaction {
  attributes?: {
    operation_type?: unknown;
    hash?: unknown;
    mined_at_block?: unknown;
    mined_at?: unknown;
    status?: unknown;
    transfers?: unknown;
  } | null;
}
export interface ZPage {
  data?: unknown;
  links?: { next?: unknown } | null;
}

// ── small, total helpers ──────────────────────────────────────────────────────
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function txHash(v: unknown): `0x${string}` | undefined {
  const s = str(v)?.toLowerCase();
  return s && /^0x[0-9a-f]{64}$/.test(s) ? (s as `0x${string}`) : undefined;
}

function unixSeconds(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/**
 * The token address on `chainSlug`. `implementations` lists the SAME asset on every
 * chain Zerion knows (USDC carries ~45 entries), so picking `[0]` would store an
 * Ethereum address against a Base transfer. Returning undefined means the asset does
 * not exist on this chain, which is not a transfer we can map.
 */
function implementationFor(fungible: ZFungible | null | undefined, chainSlug: string): { address: string; decimals: number } | undefined {
  const list = Array.isArray(fungible?.implementations) ? (fungible.implementations as ZImplementation[]) : [];
  for (const impl of list) {
    if (!impl || typeof impl !== "object") continue;
    if (str(impl.chain_id) !== chainSlug) continue;
    // A native asset has a null / empty address; keep it as "" (WalletTx's convention).
    return { address: str(impl.address)?.toLowerCase() ?? "", decimals: num(impl.decimals) ?? 18 };
  }
  return undefined;
}

/** Human amount, preferring the exact integer + decimals over the pre-rounded float. */
function amountOf(q: ZQuantity | null | undefined, fallbackDecimals: number): number | undefined {
  if (!q || typeof q !== "object") return undefined;
  const raw = str(q.int);
  const decimals = num(q.decimals) ?? fallbackDecimals;
  if (raw && /^\d+$/.test(raw) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) {
    const n = Number(formatUnits(BigInt(raw), decimals));
    if (Number.isFinite(n)) return n;
  }
  return num(q.float) ?? num(q.numeric);
}

/**
 * One page of Zerion transactions → `WalletTx[]`, newest first, one row per transfer.
 *
 * `tokens` maps a lowercased contract address to our registry label, so a transfer of
 * a Stax asset carries our symbol rather than the issuer's on-chain ticker; anything
 * we do not know keeps Zerion's. Unmappable transfers — an NFT, a `self` move, an
 * asset that is not on this chain, a missing hash, block or amount — are dropped
 * rather than guessed at. `value` is ignored entirely: it is null for aTokens.
 * Never throws, whatever the payload looks like.
 */
export function mapZerionTransfers(
  page: ZPage | null | undefined,
  chainSlug: string,
  tokens: Map<string, { symbol: string; decimals: number }>,
): WalletTx[] {
  const rows = Array.isArray(page?.data) ? (page.data as ZTransaction[]) : [];
  const out: WalletTx[] = [];

  for (const row of rows) {
    const attrs = row && typeof row === "object" ? row.attributes : undefined;
    if (!attrs || typeof attrs !== "object") continue;

    // `status` is confirmed | failed | pending. Only a mined, successful tx moved money.
    const status = str(attrs.status);
    if (status && status !== "confirmed") continue;

    const hash = txHash(attrs.hash);
    const blockNumber = num(attrs.mined_at_block);
    if (!hash || blockNumber === undefined || blockNumber <= 0) continue;
    const timestamp = unixSeconds(attrs.mined_at);

    // An approval is an operation with no transfers at all — nothing to map, not an error.
    const transfers = Array.isArray(attrs.transfers) ? (attrs.transfers as ZTransfer[]) : [];
    for (const t of transfers) {
      if (!t || typeof t !== "object") continue;
      if (t.nft_info) continue; // fungible transfers only
      const direction = str(t.direction);
      if (direction !== "in" && direction !== "out") continue; // 'self' moves nothing

      const impl = implementationFor(t.fungible_info, chainSlug);
      if (!impl) continue;
      const known = tokens.get(impl.address);
      const amount = amountOf(t.quantity, known?.decimals ?? impl.decimals);
      if (amount === undefined) continue;

      const counterparty = str(direction === "out" ? t.recipient : t.sender);
      if (!counterparty) continue;

      out.push({
        hash,
        direction,
        symbol: known?.symbol ?? str(t.fungible_info?.symbol) ?? "?",
        amount,
        counterparty: counterparty.toLowerCase(),
        tokenAddress: impl.address,
        blockNumber: Math.floor(blockNumber),
        timestamp,
      });
    }
  }
  return out;
}

function authHeader(key: string): string {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function firstPageUrl(address: string, chainSlug: string): string {
  const params = new URLSearchParams({ "filter[chain_ids]": chainSlug, "page[size]": String(PAGE_SIZE) });
  return `${BASE_URL}/wallets/${address}/transactions/?${params.toString()}`;
}

/**
 * Up to `max` transfers for `address` on `chain`, newest first. Zerion returns far
 * fewer transactions per page than `page[size]` asks for, so `links.next` is followed
 * until we have enough or MAX_PAGES is reached. Throws on a transport or HTTP failure
 * so the caller falls through to the next source.
 */
export async function fetchZerionTransfers(
  chain: StaxChain,
  address: string,
  max: number,
  tokens: Map<string, { symbol: string; decimals: number }>,
): Promise<WalletTx[]> {
  const key = ZERION_KEY;
  const chainSlug = ZERION_CHAIN[chain.key];
  if (!key || !chainSlug) throw new Error("zerion not configured for chain");

  const headers = { accept: "application/json", authorization: authHeader(key) };
  let url: string | undefined = firstPageUrl(address, chainSlug);
  const all: WalletTx[] = [];

  for (let page = 0; page < MAX_PAGES && url && all.length < max; page++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`zerion ${res.status}`);
    const json = (await res.json()) as ZPage;
    all.push(...mapZerionTransfers(json, chainSlug, tokens));
    url = str(json.links?.next);
  }

  return all.sort((a, b) => b.blockNumber - a.blockNumber).slice(0, max);
}
