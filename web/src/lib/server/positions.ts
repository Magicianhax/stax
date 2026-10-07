import "server-only";

// Portfolio history for one account on one chain: cost basis per holding (lots),
// and the account's value over a range. Read by /api/portfolio/history.
//
// Sources, merged and de-duplicated by (txHash, symbol):
//   Vera fills   — executor_events LegFilled rows of the user's AllocationExecuted
//                  txs: usdcIn (6 dp) → cost, received (asset decimals) → qty.
//                  usdcIn is net of the platform fee; the fee is added back from
//                  the treasury transfer in the same tx (or the fee constant), so
//                  Vera and manual lots both mean "what you paid".
//   Manual trades — wallet token transfers grouped by tx: USDC out + one asset in
//                  is a buy (cost = all USDC out, fee included); one asset out +
//                  USDC in is a sell (proceeds = USDC in). aUSDC is 1:1 (Aave
//                  supply / withdraw). Txs already covered by Vera fills are skipped.
//   Prices       — price_snapshots (≤ every 15 min since 2026-09-06) for the line,
//                  plus the live DEX price for the last point and the unrealized P&L.
//
// Everything is cached per (chain, account) for 60 s in module memory.
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { StaxChain } from "@/lib/chains/types";
import { db, executorEvents, priceSnapshots } from "@/lib/db";
import { ERC20_ABI } from "@/lib/abis";
import { STAX_FEE_BPS, STAX_TREASURY } from "@/lib/fees";
import { fromUnits } from "@/lib/format";
import { priceAll } from "@/lib/prices";
import { manualTrades, type TxGroup } from "@/lib/manualTrades";
import { serverClient } from "@/lib/server/chain";
import { getWalletTransfers } from "@/lib/server/walletTransfers";
import type { MarketRange } from "@/hooks/useMarket";
import {
  buildPositions,
  downsample,
  sortTrades,
  totalsOf,
  valueSeries,
  type HistoryTotals,
  type PositionHistory,
  type SeriesPoint,
  type Trade,
} from "@/lib/positions";

const TTL_MS = 60_000;
/** Shorter cache when the provider gave us nothing, so the next view retries the manual lots. */
const PARTIAL_TTL_MS = 10_000;
/** Wallet transfers to pull for cost basis (the wallet screen asks for 50; Blockscout caps around 500). */
const TRANSFER_ROWS = 500;
const MAX_POINTS = 60;
const DAY = 86_400e3;
const RANGE_SPAN: Record<MarketRange, number> = {
  "1D": DAY,
  "1W": 7 * DAY,
  "1M": 30 * DAY,
  "1Y": 365 * DAY,
  "5Y": 5 * 365 * DAY,
};

interface Ledger {
  trades: Trade[];
  cashUsd: number;
  /** Live price per held symbol (undefined when unpriced). */
  prices: Record<string, number | undefined>;
  /** Earliest price snapshot on the chain, unix seconds, or null when none. */
  coverageFrom: number | null;
  /** Unix ms when the ledger was built. */
  asOf: number;
  /** True when the wallet-transfer source returned nothing (manual lots may be missing). */
  partial: boolean;
}

const ledgers = new Map<string, { at: number; ttl: number; value: Promise<Ledger> }>();

function ledgerFor(chain: StaxChain, account: `0x${string}`): Promise<Ledger> {
  const key = `${chain.key}:${account.toLowerCase()}`;
  const hit = ledgers.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const entry = { at: Date.now(), ttl: TTL_MS, value: Promise.resolve() as unknown as Promise<Ledger> };
  entry.value = loadLedger(chain, account)
    .then((l) => {
      if (l.partial) entry.ttl = PARTIAL_TTL_MS;
      return l;
    })
    .catch((err) => {
      ledgers.delete(key);
      throw err;
    });
  ledgers.set(key, entry);
  return entry.value;
}

// ── sources ───────────────────────────────────────────────────────────────────
type EventRow = typeof executorEvents.$inferSelect;

function dataOf(row: EventRow): Record<string, unknown> {
  return row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
}

function units(raw: unknown, decimals: number): number {
  try {
    return fromUnits(BigInt(String(raw ?? "0")), decimals);
  } catch {
    return 0;
  }
}

/** Vera fills for `account`: one buy per (tx, symbol), cost = usdcIn (fee added back by the caller). */
async function veraFills(chain: StaxChain, account: `0x${string}`): Promise<{ trades: Trade[]; txs: Set<string> }> {
  const txs = new Set<string>();
  if (!chain.contracts.deployed) return { trades: [], txs };
  const execs = await db
    .select({ txHash: executorEvents.txHash })
    .from(executorEvents)
    .where(
      and(
        eq(executorEvents.chain, chain.key),
        eq(executorEvents.event, "AllocationExecuted"),
        eq(executorEvents.user, account.toLowerCase()),
      ),
    );
  for (const e of execs) txs.add(e.txHash.toLowerCase());
  if (!txs.size) return { trades: [], txs };

  const bySymbolAddr = new Map<string, { symbol: string; decimals: number }>(
    chain.assets.all.filter((a) => !!a.address).map((a) => [a.address!.toLowerCase(), { symbol: a.symbol, decimals: a.decimals ?? 18 }]),
  );
  const legs = await db
    .select()
    .from(executorEvents)
    .where(and(eq(executorEvents.chain, chain.key), eq(executorEvents.event, "LegFilled"), inArray(executorEvents.txHash, [...txs])))
    .orderBy(asc(executorEvents.blockNumber), asc(executorEvents.logIndex));

  // Two legs for one symbol in one tx (never today) merge into one lot.
  const merged = new Map<string, Trade>();
  for (const l of legs) {
    const d = dataOf(l);
    const asset = bySymbolAddr.get(String(d.tokenOut ?? "").toLowerCase());
    if (!asset) continue;
    const key = `${l.txHash.toLowerCase()}:${asset.symbol}`;
    const usdc = units(d.usdcIn, chain.usdc.decimals);
    const qty = units(d.received, asset.decimals);
    if (qty <= 0) continue;
    const prev = merged.get(key);
    if (prev) {
      prev.qty += qty;
      prev.usdc += usdc;
    } else {
      merged.set(key, {
        symbol: asset.symbol,
        txHash: l.txHash.toLowerCase(),
        at: Math.floor(l.timestamp.getTime() / 1000),
        qty,
        usdc,
        kind: "vera",
        side: "buy",
      });
    }
  }
  return { trades: [...merged.values()], txs };
}

/** Wallet transfers grouped by tx, with the fee transfer to the treasury separated out. */
async function transferGroups(chain: StaxChain, account: `0x${string}`): Promise<{ groups: Map<string, TxGroup>; partial: boolean }> {
  // The provider is flaky on wide pages ("Something went wrong" / 429): a second,
  // smaller read is a different cache key, so it still catches the recent manual
  // trades rather than none.
  let txs = await getWalletTransfers(chain, account, TRANSFER_ROWS);
  if (!txs.length) txs = await getWalletTransfers(chain, account);
  const usdcSymbol = chain.usdc.symbol;
  const treasury = STAX_TREASURY.toLowerCase();
  const groups = new Map<string, TxGroup>();
  for (const t of txs) {
    const hash = t.hash.toLowerCase();
    let g = groups.get(hash);
    if (!g) {
      g = { hash, at: t.timestamp ?? 0, usdcOut: 0, usdcIn: 0, feeOut: 0, assetIn: new Map(), assetOut: new Map() };
      groups.set(hash, g);
    }
    if (t.symbol === usdcSymbol) {
      if (t.direction === "in") g.usdcIn += t.amount;
      else if (t.counterparty.toLowerCase() === treasury) g.feeOut += t.amount;
      else g.usdcOut += t.amount;
    } else {
      const m = t.direction === "in" ? g.assetIn : g.assetOut;
      m.set(t.symbol, (m.get(t.symbol) ?? 0) + t.amount);
    }
  }
  return { groups, partial: txs.length === 0 };
}

async function loadLedger(chain: StaxChain, account: `0x${string}`): Promise<Ledger> {
  const client = serverClient(chain);
  const [vera, transfers, cashRaw, coverage] = await Promise.all([
    veraFills(chain, account),
    transferGroups(chain, account).catch((err) => {
      console.warn(`[positions] transfers failed on ${chain.key}:`, err instanceof Error ? err.message : err);
      return { groups: new Map<string, TxGroup>(), partial: true };
    }),
    client
      .readContract({ address: chain.usdc.address, abi: ERC20_ABI, functionName: "balanceOf", args: [account] })
      .then((r) => r as bigint)
      .catch(() => BigInt(0)),
    db
      .select({ min: sql<string | null>`min(${priceSnapshots.takenAt})` })
      .from(priceSnapshots)
      .where(eq(priceSnapshots.chain, chain.key))
      .then(([row]) => (row?.min ? Math.floor(new Date(row.min).getTime() / 1000) : null)),
  ]);

  // Add the platform fee back onto Vera legs, pro rata, from the treasury transfer
  // in the same tx when the explorer shows it, else from the fee constant.
  const { groups } = transfers;
  const grossUp = 10_000 / (10_000 - STAX_FEE_BPS);
  const byTx = new Map<string, Trade[]>();
  for (const t of vera.trades) byTx.set(t.txHash, [...(byTx.get(t.txHash) ?? []), t]);
  for (const [hash, legs] of byTx) {
    const net = legs.reduce((s, l) => s + l.usdc, 0);
    const fee = groups.get(hash)?.feeOut;
    for (const l of legs) {
      l.usdc = fee !== undefined && net > 0 ? l.usdc + fee * (l.usdc / net) : l.usdc * grossUp;
      l.usdc = Math.round(l.usdc * 1e6) / 1e6;
    }
  }

  const manualOpts = {
    knownSymbols: new Set(chain.assets.all.map((a) => a.symbol)),
    safeSymbols: new Set(chain.assets.safe.map((a) => a.symbol)),
    veraTxs: vera.txs,
  };
  // A first pass finds every symbol that has a lot (a multi-leg plan splits its cash by the value
  // each holding received, which needs a price); the second pass is the real ledger.
  const firstPass = sortTrades([...vera.trades, ...manualTrades(groups.values(), manualOpts)]);
  const symbols = [...new Set(firstPass.map((t) => t.symbol))];
  const assets = chain.assets.all.filter((a) => symbols.includes(a.symbol));
  const prices: Record<string, number | undefined> = {};
  if (assets.length) {
    try {
      const all = await priceAll(chain, client, assets);
      for (const a of assets) prices[a.symbol] = all[a.symbol]?.priceUsd;
    } catch (err) {
      console.warn(`[positions] prices failed on ${chain.key}:`, err instanceof Error ? err.message : err);
    }
  }
  const trades = sortTrades([...vera.trades, ...manualTrades(groups.values(), { ...manualOpts, priceOf: (s) => prices[s] })]);
  return { trades, cashUsd: fromUnits(cashRaw, chain.usdc.decimals), prices, coverageFrom: coverage, asOf: Date.now(), partial: transfers.partial };
}

// ── public API ────────────────────────────────────────────────────────────────
export interface PositionHistoryResult {
  positions: PositionHistory[];
  totals: HistoryTotals;
  cashUsd: number;
  coverageFrom: number | null;
}

/** Cost basis, unrealized and realized P&L per held symbol, with every lot. */
export async function getPositionHistory(chain: StaxChain, account: `0x${string}`): Promise<PositionHistoryResult> {
  const ledger = await ledgerFor(chain, account);
  const positions = buildPositions(ledger.trades, (s) => ledger.prices[s]);
  return { positions, totals: totalsOf(positions), cashUsd: ledger.cashUsd, coverageFrom: ledger.coverageFrom };
}

export interface ValueHistoryResult {
  /** Account value over the range, ≤ 60 points plus a live "now" point. `t` in ms. */
  series: SeriesPoint[];
  coverageFrom: number | null;
}

/**
 * Account value at each price snapshot in `range` (held symbols only, ≤ 60
 * points) plus a final point at live prices. Snapshots began 2026-09-06, so a
 * longer range simply starts where they start — `coverageFrom` says when.
 * Cash is reconstructed from trades; deposits are not modelled (see lib/positions).
 */
export async function getValueHistory(chain: StaxChain, account: `0x${string}`, range: MarketRange): Promise<ValueHistoryResult> {
  const ledger = await ledgerFor(chain, account);
  const symbols = [...new Set(ledger.trades.map((t) => t.symbol))];
  const now = ledger.asOf;
  const start = new Date(now - RANGE_SPAN[range]);

  const byTime = new Map<number, Map<string, number>>();
  if (symbols.length) {
    const rows = await db
      .select({ symbol: priceSnapshots.symbol, priceUsd: priceSnapshots.priceUsd, takenAt: priceSnapshots.takenAt })
      .from(priceSnapshots)
      .where(and(eq(priceSnapshots.chain, chain.key), inArray(priceSnapshots.symbol, symbols), gte(priceSnapshots.takenAt, start)))
      .orderBy(asc(priceSnapshots.takenAt));
    for (const r of rows) {
      const t = r.takenAt.getTime();
      const p = Number(r.priceUsd);
      if (!Number.isFinite(p)) continue;
      let m = byTime.get(t);
      if (!m) {
        m = new Map();
        byTime.set(t, m);
      }
      m.set(r.symbol, p);
    }
  }
  const times = downsample([...byTime.keys()].sort((a, b) => a - b), MAX_POINTS - 1);

  // A symbol missing at one snapshot carries its last known price forward.
  const last = new Map<string, number>();
  const priceAt = (symbol: string, t: number): number | undefined => {
    if (t === now) return ledger.prices[symbol] ?? last.get(symbol);
    const p = byTime.get(t)?.get(symbol);
    if (p !== undefined) last.set(symbol, p);
    return p ?? last.get(symbol);
  };
  const series = valueSeries([...times, now], ledger.trades, priceAt, ledger.cashUsd);
  return { series, coverageFrom: ledger.coverageFrom };
}
