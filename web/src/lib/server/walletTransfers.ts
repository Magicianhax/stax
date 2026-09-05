import "server-only";

// Wallet transaction history (incoming + outgoing token transfers), per chain.
//
// Reality check: Alchemy's enhanced getAssetTransfers is NOT enabled on Mantle,
// and its FREE-tier eth_getLogs is capped at a 10-block range — so logs can't
// reconstruct history without a paid plan. The right tool is an indexed explorer
// API: Etherscan V2 (`chainid=${chain.etherscanChainId}`, the engine behind
// basescan.org / mantlescan.xyz) returns a wallet's full ERC-20 transfer history
// in one fast call.
//
// Order of preference:
//   1. Etherscan V2 `account/tokentx`  (ETHERSCAN_API_KEY — free, recommended)
//   2. Alchemy eth_getLogs scan         (only works on a PAYG Alchemy plan)
import { createPublicClient, http, getAddress, formatUnits, parseAbiItem, isAddress, type PublicClient } from "viem";
import type { ChainKey, StaxChain } from "@/lib/chains/types";
import type { WalletTx } from "@/lib/walletTx";

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
const MAX = 50;

/** Which data source the history will use (surfaced in the API response). */
export const TXN_SOURCE: "etherscan" | "alchemy-logs" | "none" =
  ETHERSCAN_KEY ? "etherscan" : ALCHEMY_KEY ? "alchemy-logs" : "none";

/** Alchemy RPC for `chain` (network slug derives from the chain key: base-mainnet / mantle-mainnet). */
function alchemyRpc(chain: StaxChain): string | null {
  return ALCHEMY_KEY ? `https://${chain.key}-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : null;
}

// Known tokens per chain: address(lowercase) -> { symbol, decimals } so transfers get our labels.
const tokenMaps = new Map<ChainKey, Map<string, { symbol: string; decimals: number }>>();
function knownTokens(chain: StaxChain) {
  let m = tokenMaps.get(chain.key);
  if (!m) {
    m = new Map();
    m.set(chain.usdc.address.toLowerCase(), { symbol: chain.usdc.symbol, decimals: chain.usdc.decimals });
    for (const a of chain.assets.all) {
      if (a.address && a.decimals) m.set(a.address.toLowerCase(), { symbol: a.symbol, decimals: a.decimals });
    }
    tokenMaps.set(chain.key, m);
  }
  return m;
}

function dedupeSort(txs: WalletTx[]): WalletTx[] {
  const seen = new Set<string>();
  const unique = txs.filter((t) => {
    const key = `${t.hash}:${t.direction}:${t.tokenAddress}:${t.counterparty}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => b.blockNumber - a.blockNumber);
  return unique.slice(0, MAX);
}

// ── 1) Etherscan V2 (recommended) ─────────────────────────────────────────────
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

async function viaEtherscan(chain: StaxChain, address: string): Promise<WalletTx[]> {
  const tokens = knownTokens(chain);
  const url =
    `https://api.etherscan.io/v2/api?chainid=${chain.etherscanChainId}&module=account&action=tokentx` +
    `&address=${address}&page=1&offset=${MAX}&sort=desc&apikey=${ETHERSCAN_KEY}`;
  const res = await fetch(url);
  const json = (await res.json()) as { status: string; message: string; result: EsTransfer[] | string };

  if (json.status !== "1" || !Array.isArray(json.result)) {
    if (typeof json.message === "string" && json.message.toLowerCase().includes("no transactions")) return [];
    throw new Error(typeof json.result === "string" ? json.result : json.message || "etherscan error");
  }

  const lc = address.toLowerCase();
  const txs = json.result.map((t): WalletTx => {
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
      hash: t.hash as `0x${string}`,
      direction: out ? "out" : "in",
      symbol: known?.symbol ?? t.tokenSymbol ?? "?",
      amount,
      counterparty: out ? t.to : t.from,
      tokenAddress: tokenAddr,
      blockNumber: Number(t.blockNumber) || 0,
      timestamp: Number.isFinite(ts) && ts > 0 ? ts : undefined,
    };
  });
  return dedupeSort(txs);
}

// ── 2) Alchemy eth_getLogs (PAYG plans only — free tier caps at 10 blocks) ─────
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

async function viaLogs(chain: StaxChain, rpc: string, address: string): Promise<WalletTx[]> {
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
      hash: (l.transactionHash ?? "0x") as `0x${string}`,
      direction,
      symbol: meta?.symbol ?? "?",
      amount: meta ? Number(formatUnits(l.args.value ?? BigInt(0), meta.decimals)) : 0,
      counterparty: (direction === "out" ? l.args.to : l.args.from) ?? "",
      tokenAddress: l.address.toLowerCase(),
      blockNumber: Number(l.blockNumber ?? BigInt(0)),
    };
  };
  const txs = dedupeSort([...outLogs.map((l) => mapLog(l, "out")), ...inLogs.map((l) => mapLog(l, "in"))]);

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

/** Incoming + outgoing transfers for `address` on `chain`, newest first. */
export async function getWalletTransfers(chain: StaxChain, address: string): Promise<WalletTx[]> {
  if (!isAddress(address)) return [];
  if (ETHERSCAN_KEY) {
    try {
      return await viaEtherscan(chain, address);
    } catch {
      /* fall through */
    }
  }
  const rpc = alchemyRpc(chain);
  if (rpc) {
    try {
      return await viaLogs(chain, rpc, address);
    } catch {
      /* free-tier 10-block cap / unsupported — give up gracefully */
    }
  }
  return [];
}
