import "server-only";

// Wallet transaction history (incoming + outgoing token transfers), per chain.
//
// Zerion already indexes this, so Stax does not keep its own copy: we ask a
// provider and cache the answer for 60 s through the shared Redis layer
// (lib/server/cache.ts), which absorbs a blip, a burst of page views and the
// providers' rate limits without a table, a cursor or a cron.
//
// Sources, in order — the first that `supports()` the chain and answers wins:
//   1. zerion        ZERION_API_KEY, Base. Operations already broken into transfers.
//   2. etherscan     ETHERSCAN_API_KEY. Etherscan V2 `account/tokentx` (the engine
//                    behind basescan.org / mantlescan.xyz) serves Mantle; the free
//                    tier refuses Base, so on Base it falls through.
//   3. blockscout    No key, same `account/tokentx` dialect.
//   4. alchemy-logs  Last resort. A raw Transfer log scan — the free tier caps
//                    eth_getLogs at a 10-block range, so it needs a PAYG plan.
//
// A source error falls through to the next. When every one fails the result is an
// empty list with the failure logged, and nothing is cached, so the next request
// retries immediately. This never throws.
import { createPublicClient, http, getAddress, formatUnits, parseAbiItem, isAddress, type PublicClient } from "viem";
import type { ChainKey, StaxChain } from "@/lib/chains/types";
import type { WalletTx } from "@/lib/walletTx";
import { cached } from "@/lib/server/cache";
import { fetchZerionTransfers, zerionSupports } from "@/lib/server/zerion";

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;

/** Rows the wallet screen shows. Cost basis asks for the lot (see positions.ts). */
const MAX = 50;
/** How long one wallet's history is reused. Short: new transfers should show up quickly. */
const CACHE_TTL_SECONDS = 60;

/** Which provider produced a given response. Never a module-load constant. */
export type TxnSource = "zerion" | "etherscan" | "blockscout" | "alchemy-logs" | "none";

/**
 * One provider of wallet history. `fetch` returns at most `max` transfers, newest
 * first, and THROWS on failure so the next source is tried. An empty array means
 * "this wallet has no history", not "I am broken".
 */
export interface TransferSource {
  name: Exclude<TxnSource, "none">;
  supports(chain: StaxChain): boolean;
  fetch(chain: StaxChain, address: string, max: number): Promise<WalletTx[]>;
}

// ── token labels ──────────────────────────────────────────────────────────────
// Known tokens per chain: address(lowercase) -> { symbol, decimals } so transfers get our labels.
const tokenMaps = new Map<ChainKey, Map<string, { symbol: string; decimals: number }>>();

export function knownTokens(chain: StaxChain): Map<string, { symbol: string; decimals: number }> {
  let m = tokenMaps.get(chain.key);
  if (!m) {
    m = new Map();
    m.set(chain.usdc.address.toLowerCase(), { symbol: chain.usdc.symbol, decimals: chain.usdc.decimals });
    for (const a of chain.assets.all) {
      if (a.address && a.decimals) m.set(a.address.toLowerCase(), { symbol: a.symbol, decimals: a.decimals });
      // BNB Chain: the other issuer's mint of the same stock is the same holding, in its own
      // decimals. Unmapped, a twin transfer read as an unknown "?" token and never reached cost basis.
      if (a.twin) m.set(a.twin.address.toLowerCase(), { symbol: a.symbol, decimals: a.twin.decimals });
    }
    tokenMaps.set(chain.key, m);
  }
  return m;
}

export function dedupeSort(txs: WalletTx[], max = MAX): WalletTx[] {
  const seen = new Set<string>();
  const unique = txs.filter((t) => {
    const key = `${t.hash}:${t.direction}:${t.tokenAddress}:${t.counterparty}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => b.blockNumber - a.blockNumber);
  return unique.slice(0, max);
}

// ── 1) Zerion ─────────────────────────────────────────────────────────────────
const zerionSource: TransferSource = {
  name: "zerion",
  supports: zerionSupports,
  // Already one row per transfer and newest first; dedupeSort only enforces the cap.
  fetch: async (chain, address, max) => dedupeSort(await fetchZerionTransfers(chain, address, max, knownTokens(chain)), max),
};

// ── 2/3) Etherscan V2 and Blockscout (the same `account/tokentx` dialect) ──────
interface EsTransfer {
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  blockNumber: string;
  timeStamp: string;
}

interface EsPayload {
  status?: string;
  message?: string;
  result?: EsTransfer[] | string;
}

/**
 * An Etherscan-compatible `account/tokentx` payload → `WalletTx[]`, newest first.
 * Pure: no network, no clock. Throws on an error payload so the caller falls through
 * to the next source; returns `[]` for the explorers' "no transactions found", which
 * is a real answer about an empty wallet.
 */
export function parseExplorerTransfers(chain: StaxChain, address: string, payload: EsPayload, max = MAX): WalletTx[] {
  const tokens = knownTokens(chain);
  // Etherscan reports status "1"; Blockscout reports message "OK" (status may be absent).
  const rows = Array.isArray(payload?.result) ? payload.result : undefined;
  const ok = rows !== undefined && (payload.status === "1" || payload.message === "OK" || payload.status === undefined);
  if (!ok) {
    const message = typeof payload?.message === "string" ? payload.message : "";
    const detail = typeof payload?.result === "string" ? payload.result : "";
    if (`${message} ${detail}`.toLowerCase().includes("no transactions")) return [];
    throw new Error(detail || message || "explorer error");
  }

  const lc = address.toLowerCase();
  const txs = rows.map((t): WalletTx => {
    const out = t.from?.toLowerCase() === lc;
    const tokenAddr = t.contractAddress?.toLowerCase() ?? "";
    const known = tokens.get(tokenAddr);
    const decimals = known?.decimals ?? (Number(t.tokenDecimal) || 18);
    let amount = 0;
    try {
      amount = Number(formatUnits(BigInt(t.value), decimals));
    } catch {
      amount = 0;
    }
    const ts = Number(t.timeStamp);
    return {
      hash: (t.hash?.toLowerCase() ?? "0x") as `0x${string}`,
      direction: out ? "out" : "in",
      symbol: known?.symbol ?? t.tokenSymbol ?? "?",
      amount,
      counterparty: (out ? t.to : t.from)?.toLowerCase() ?? "",
      tokenAddress: tokenAddr,
      blockNumber: Number(t.blockNumber) || 0,
      timestamp: Number.isFinite(ts) && ts > 0 ? ts : undefined,
    };
  });
  return dedupeSort(txs, max);
}

async function fetchExplorer(chain: StaxChain, url: string, address: string, max: number): Promise<WalletTx[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  return parseExplorerTransfers(chain, address, (await res.json()) as EsPayload, max);
}

const etherscanSource: TransferSource = {
  name: "etherscan",
  supports: () => Boolean(ETHERSCAN_KEY),
  fetch: (chain, address, max) =>
    fetchExplorer(
      chain,
      `https://api.etherscan.io/v2/api?chainid=${chain.etherscanChainId}&module=account&action=tokentx` +
        `&address=${address}&page=1&offset=${max}&sort=desc&apikey=${ETHERSCAN_KEY}`,
      address,
      max,
    ),
};

const blockscoutSource: TransferSource = {
  name: "blockscout",
  supports: (chain) => Boolean(chain.blockscoutUrl),
  fetch: (chain, address, max) =>
    fetchExplorer(
      chain,
      `${chain.blockscoutUrl}/api?module=account&action=tokentx&address=${address}&page=1&offset=${max}&sort=desc`,
      address,
      max,
    ),
};

// ── 4) Alchemy eth_getLogs (PAYG plans only — free tier caps at 10 blocks) ─────
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const alchemyClients = new Map<ChainKey, PublicClient>();

function alchemyClient(chain: StaxChain, rpc: string): PublicClient {
  let c = alchemyClients.get(chain.key);
  if (!c) {
    c = createPublicClient({ chain: chain.chain, transport: http(rpc) }) as PublicClient;
    alchemyClients.set(chain.key, c);
  }
  return c;
}

async function viaLogs(chain: StaxChain, address: string, max: number): Promise<WalletTx[]> {
  const rpc = ALCHEMY_KEY ? `https://${chain.key}-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : null;
  if (!rpc) throw new Error("no alchemy key");
  const client = alchemyClient(chain, rpc);
  const tokens = knownTokens(chain);
  const owner = getAddress(address);
  const tokenAddrs = [...tokens.keys()].map((a) => getAddress(a));
  const fromBlock = chain.contracts.executorBlock;

  const [outLogs, inLogs] = await Promise.all([
    client.getLogs({ address: tokenAddrs, event: TRANSFER, args: { from: owner }, fromBlock, toBlock: "latest" }),
    client.getLogs({ address: tokenAddrs, event: TRANSFER, args: { to: owner }, fromBlock, toBlock: "latest" }),
  ]);
  const mapLog = (l: (typeof outLogs)[number], direction: "in" | "out"): WalletTx => {
    const meta = tokens.get(l.address.toLowerCase());
    return {
      hash: (l.transactionHash?.toLowerCase() ?? "0x") as `0x${string}`,
      direction,
      symbol: meta?.symbol ?? "?",
      amount: meta ? Number(formatUnits(l.args.value ?? BigInt(0), meta.decimals)) : 0,
      counterparty: ((direction === "out" ? l.args.to : l.args.from) ?? "").toLowerCase(),
      tokenAddress: l.address.toLowerCase(),
      blockNumber: Number(l.blockNumber ?? BigInt(0)),
    };
  };
  const txs = dedupeSort([...outLogs.map((l) => mapLog(l, "out")), ...inLogs.map((l) => mapLog(l, "in"))], max);

  const blocks = [...new Set(txs.map((t) => t.blockNumber))].slice(0, 40);
  const tsByBlock = new Map<number, number>();
  await Promise.all(
    blocks.map(async (bn) => {
      try {
        const b = await client.getBlock({ blockNumber: BigInt(bn) });
        tsByBlock.set(bn, Number(b.timestamp));
      } catch {
        /* leave undefined */
      }
    }),
  );
  return txs.map((t) => ({ ...t, timestamp: tsByBlock.get(t.blockNumber) }));
}

const logsSource: TransferSource = {
  name: "alchemy-logs",
  supports: () => Boolean(ALCHEMY_KEY),
  fetch: (chain, address, max) => viaLogs(chain, address, max),
};

/** Every source that can serve `chain`, best first. */
export function sourcesFor(chain: StaxChain): TransferSource[] {
  return [zerionSource, etherscanSource, blockscoutSource, logsSource].filter((s) => s.supports(chain));
}

// ── public API ────────────────────────────────────────────────────────────────
export interface WalletHistory {
  transactions: WalletTx[];
  /** The provider that actually answered — "none" when every one of them failed. */
  source: TxnSource;
}

/** Ask each source in turn. Throws only when every one failed, so nothing is cached. */
async function fetchFresh(chain: StaxChain, address: string, max: number): Promise<WalletHistory> {
  const sources = sourcesFor(chain);
  for (const source of sources) {
    try {
      return { transactions: await source.fetch(chain, address, max), source: source.name };
    } catch (err) {
      console.warn(`[transfers] ${source.name} failed on ${chain.key}:`, err instanceof Error ? err.message : err);
    }
  }
  throw new Error(sources.length ? "every transfer source failed" : "no transfer source configured");
}

/**
 * A wallet's transfers with the provider that served them, cached per
 * (chain, address, max) for 60 s. A failure is not cached, so the next request
 * retries rather than serving an empty list for a minute.
 */
export async function getWalletHistory(chain: StaxChain, address: string, max = MAX): Promise<WalletHistory> {
  if (!isAddress(address)) return { transactions: [], source: "none" };
  const key = `transfers:${chain.key}:${address.toLowerCase()}:${max}`;
  try {
    return await cached(key, CACHE_TTL_SECONDS, () => fetchFresh(chain, address, max));
  } catch (err) {
    console.error(`[transfers] no source could serve ${chain.key}:`, err instanceof Error ? err.message : err);
    return { transactions: [], source: "none" };
  }
}

/**
 * Incoming + outgoing transfers for `address` on `chain`, newest first.
 * `max` caps the rows (50 for the wallet screen; cost basis asks for the lot).
 */
export async function getWalletTransfers(chain: StaxChain, address: string, max = MAX): Promise<WalletTx[]> {
  return (await getWalletHistory(chain, address, max)).transactions;
}
