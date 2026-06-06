import "server-only";

// Wallet transaction history (incoming + outgoing token transfers).
//
// Mantle reality check: Alchemy's enhanced getAssetTransfers is NOT enabled on
// Mantle, and its FREE-tier eth_getLogs is capped at a 10-block range — so logs
// can't reconstruct history without a paid plan. The right tool is an indexed
// explorer API: Etherscan V2 (chainid 5000, the engine behind mantlescan.xyz)
// returns a wallet's full ERC-20 transfer history in one fast call.
//
// Order of preference:
//   1. Etherscan V2 `account/tokentx`  (ETHERSCAN_API_KEY — free, recommended)
//   2. Alchemy eth_getLogs scan         (only works on a PAYG Alchemy plan)
import { createPublicClient, http, getAddress, formatUnits, parseAbiItem, isAddress } from "viem";
import { MANTLE_CHAIN, USDC, ALL_ASSETS } from "@/lib/mantle";
import type { WalletTx } from "@/lib/walletTx";

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
const ALCHEMY_RPC = ALCHEMY_KEY ? `https://mantle-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : null;
const RPC = ALCHEMY_RPC || process.env.NEXT_PUBLIC_MANTLE_RPC_URL || "https://rpc.mantle.xyz";
const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_STAX_EXECUTOR_BLOCK || "96098605");
const MAX = 50;

/** Which data source the history will use (surfaced in the API response). */
export const TXN_SOURCE: "etherscan" | "alchemy-logs" | "none" =
  ETHERSCAN_KEY ? "etherscan" : ALCHEMY_RPC ? "alchemy-logs" : "none";

// Known tokens: address(lowercase) -> { symbol, decimals } so transfers get our labels.
const TOKENS = new Map<string, { symbol: string; decimals: number }>();
TOKENS.set(USDC.address.toLowerCase(), { symbol: USDC.symbol, decimals: USDC.decimals });
for (const a of ALL_ASSETS) {
  if (a.address && a.decimals) TOKENS.set(a.address.toLowerCase(), { symbol: a.symbol, decimals: a.decimals });
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

async function viaEtherscan(address: string): Promise<WalletTx[]> {
  const url =
    `https://api.etherscan.io/v2/api?chainid=${MANTLE_CHAIN.id}&module=account&action=tokentx` +
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
    const known = TOKENS.get(tokenAddr);
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
const client = createPublicClient({
  chain: { id: MANTLE_CHAIN.id, name: MANTLE_CHAIN.name, nativeCurrency: MANTLE_CHAIN.nativeCurrency, rpcUrls: MANTLE_CHAIN.rpcUrls },
  transport: http(RPC),
});

async function viaLogs(address: string): Promise<WalletTx[]> {
  const owner = getAddress(address);
  const tokenAddrs = [...TOKENS.keys()].map((a) => getAddress(a));

  const [outLogs, inLogs] = await Promise.all([
    client.getLogs({ address: tokenAddrs, event: TRANSFER, args: { from: owner }, fromBlock: DEPLOY_BLOCK, toBlock: "latest" }),
    client.getLogs({ address: tokenAddrs, event: TRANSFER, args: { to: owner }, fromBlock: DEPLOY_BLOCK, toBlock: "latest" }),
  ]);
  const mapLog = (l: (typeof outLogs)[number], direction: "in" | "out"): WalletTx => {
    const meta = TOKENS.get(l.address.toLowerCase());
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

/** Incoming + outgoing transfers for `address`, newest first. */
export async function getWalletTransfers(address: string): Promise<WalletTx[]> {
  if (!isAddress(address)) return [];
  if (ETHERSCAN_KEY) {
    try {
      return await viaEtherscan(address);
    } catch {
      /* fall through */
    }
  }
  if (ALCHEMY_RPC) {
    try {
      return await viaLogs(address);
    } catch {
      /* free-tier 10-block cap / unsupported — give up gracefully */
    }
  }
  return [];
}
